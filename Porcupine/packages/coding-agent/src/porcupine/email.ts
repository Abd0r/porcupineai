/**
 * Email integration for Porcupine (ambient email awareness).
 *
 * Universal IMAP/SMTP client built on `imapflow` and `nodemailer`, so it works
 * with Gmail, Outlook, and iCloud using an app password.
 *
 * Design notes:
 * - Thin, typed wrapper. Every network call is wrapped in a timeout and returns
 *   clean error strings (no stack dumps to the user, no secrets).
 * - v1 is read-heavy plus draft/send of plain-text messages. HTML bodies are
 *   downgraded to text, and attachments are NOT supported.
 * - Each IMAP operation opens its own connection (connect -> run -> logout) so
 *   the wrapper holds no cross-call connection state and never leaks sockets.
 */

import { createRequire } from "node:module";
// Runtime imports are lazy (imapflow ~56ms + nodemailer ~17ms at cold load):
// the email feature must not tax CLI startup. Types are compile-time only.
import type { FetchMessageObject, ImapFlow, ListResponse } from "imapflow";

// ESM build: sync require() is not available; createRequire provides it while
// keeping the modules out of the startup import graph.
const nodeRequire = createRequire(import.meta.url);
let imapflowModule: typeof import("imapflow") | undefined;
function getImapFlow(): typeof import("imapflow") {
	imapflowModule ??= nodeRequire("imapflow") as typeof import("imapflow");
	return imapflowModule;
}

let nodemailerModule: typeof import("nodemailer") | undefined;
function getNodemailer(): typeof import("nodemailer") {
	nodemailerModule ??= nodeRequire("nodemailer") as typeof import("nodemailer");
	return nodemailerModule;
}

/** Non-secret email configuration. The password is resolved via the keyring. */
export interface EmailConfig {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	pass?: string;
	draftsFolder: string;
	sentFolder: string;
	timeoutMs: number;
}

export interface EmailMessageSummary {
	uid: number;
	subject: string;
	from: string;
	date: Date | null;
}

export interface EmailMessage {
	uid: number;
	subject: string;
	from: string;
	to: string;
	date: Date | null;
	text: string;
}

/** Folder name + message count for /email status. */
export interface EmailFolderCounts {
	path: string;
	total: number;
}

export interface EmailDraftResult {
	draftId: number;
	messageId: string;
}

export interface EmailSendResult {
	messageId: string;
}

export interface EmailClient {
	listInbox(): Promise<EmailMessageSummary[]>;
	listDrafts(): Promise<EmailMessageSummary[]>;
	listSent(): Promise<EmailMessageSummary[]>;
	searchBySubject(subject: string): Promise<EmailMessageSummary[]>;
	readMessage(id: number): Promise<EmailMessage>;
	draft(to: string, subject: string, body: string): Promise<EmailDraftResult>;
	send(draftId: number): Promise<EmailSendResult>;
	folderCounts(): Promise<EmailFolderCounts[]>;
	/** Establish a connection to verify credentials; throws a clean error on failure. */
	connect(): Promise<void>;
}

/**
 * Gmail (and some other servers) ignore uid-semantics on FETCH ranges, so
 * ranges are read as sequence numbers. Map a uid to its sequence position in
 * the current mailbox via a full search (search order == message order).
 */
async function sequenceOfUid(client: ImapFlow, uid: number): Promise<number | undefined> {
	const uids = (await client.search({ all: true }, { uid: true })) || [];
	const index = uids.indexOf(uid);
	return index === -1 ? undefined : index + 1;
}

/** Map a list of uids to their sequence positions (dropping unknown ones). */
async function sequencesOfUids(client: ImapFlow, uids: number[]): Promise<number[]> {
	const all = (await client.search({ all: true }, { uid: true })) || [];
	const indexOf = new Map<number, number>();
	for (let i = 0; i < all.length; i++) {
		indexOf.set(all[i]!, i);
	}
	return uids
		.map((uid) => {
			const index = indexOf.get(uid);
			return index === undefined ? undefined : index + 1;
		})
		.filter((seq): seq is number => seq !== undefined);
}

const MAX_SUBJECT_CHARS = 200;

/** How many of the most recent messages a folder listing fetches at most. */
const LIST_FETCH_LIMIT = 50;

/** Keyring service name under which the mailbox app password is stored. */
export const EMAIL_KEYRING_SERVICE = "email";

/** Wrap a promise in a timeout; resolves the wrapped value or rejects cleanly. */
function withTimeout<T>(timeoutMs: number, label: string, promise: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Normalize an unknown thrown value into a safe, non-stack message. */
export function emailErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

// ---------------------------------------------------------------------------
// Minimal MIME text extraction (no full parser): headers/body split,
// base64 + quoted-printable decoding, multipart -> first text/plain part,
// text/html fallback downgraded to text.
// ---------------------------------------------------------------------------

function splitHeadBody(raw: string): [string, string] {
	const idx = raw.search(/\r?\n\r?\n/);
	if (idx === -1) return ["", raw];
	const step = raw[idx] === "\r" ? 4 : 2;
	return [raw.slice(0, idx), raw.slice(idx + step)];
}

function decodeTransfer(raw: string): string {
	const [head, body] = splitHeadBody(raw);
	const cte = /^content-transfer-encoding:\s*(\S+)/im.exec(head)?.[1]?.toLowerCase();
	if (cte === "base64") {
		return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8");
	}
	if (cte === "quoted-printable") {
		return body
			.replace(/=\r?\n/g, "")
			.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
	}
	return body;
}

function stripHtml(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function extractFirstPart(body: string, contentType: string, headers = ""): string | undefined {
	const boundary = /boundary\s*=\s*"?([^";\s]+)"?/i.exec(`${headers}\n${body}`)?.[1];
	if (!boundary) return undefined;
	for (const part of body.split(`--${boundary}`)) {
		if (part.toLowerCase().includes(`content-type: ${contentType}`)) {
			return decodeTransfer(part);
		}
	}
	return undefined;
}

export function extractTextBody(raw: Buffer | string | undefined): string {
	if (raw === undefined) return "(no text body)";
	const source = Buffer.isBuffer(raw) ? raw.toString("utf-8") : raw;
	const [head, body] = splitHeadBody(source);
	const trimmed = body.trim();
	if (trimmed.startsWith("<")) {
		// Single-part HTML message.
		return stripHtml(trimmed) || "(no text body)";
	}
	if (trimmed.startsWith("Content-Type:") || /^--[^\s]+/m.test(trimmed) || /^content-type:\s*multipart/i.test(head)) {
		// Multipart: prefer text/plain, fall back to text/html.
		const plain = extractFirstPart(trimmed, "text/plain", head);
		if (plain) return plain.trim() || "(no text body)";
		const html = extractFirstPart(trimmed, "text/html", head);
		if (html) return stripHtml(html) || "(no text body)";
		return "(no text body)";
	}
	return decodeTransfer(source).trim() || "(no text body)";
}

function plainBody(message: FetchMessageObject): string {
	return extractTextBody(message.source);
}

function fromAddress(address: { name?: string; address?: string } | undefined): string {
	if (!address) return "(unknown sender)";
	const name = address.name?.trim();
	const addr = address.address?.trim();
	if (name && addr) return `${name} <${addr}>`;
	return addr ?? name ?? "(unknown sender)";
}

function summaryFrom(message: FetchMessageObject): EmailMessageSummary {
	const envelope = message.envelope;
	return {
		uid: message.uid,
		subject: (envelope?.subject ?? "").slice(0, MAX_SUBJECT_CHARS) || "(no subject)",
		from: fromAddress(envelope?.from?.[0]),
		date: envelope?.date ?? null,
	};
}

/**
 * Create the email client. No connection is opened until a method is called,
 * so the caller can resolve the password from the keyring before use.
 */
export function createEmailClient(config: EmailConfig): EmailClient {
	const timeoutMs = config.timeoutMs > 0 ? config.timeoutMs : 15000;

	function imapAuth() {
		return { user: config.user, pass: config.pass ?? "" };
	}

	function requirePass(): string {
		if (!config.pass) {
			throw new Error("Email password is not configured. Provide it via the /email setup flow.");
		}
		return config.pass;
	}

	async function openImap<T>(op: (client: ImapFlow) => Promise<T>): Promise<T> {
		const client = new (getImapFlow().ImapFlow)({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: imapAuth(),
			logger: false as const,
		});
		try {
			await withTimeout(timeoutMs, "IMAP connect", client.connect());
			return await op(client);
		} finally {
			try {
				await client.logout();
			} catch {
				// best-effort disconnect
			}
		}
	}

	async function listFolder(path: string): Promise<EmailMessageSummary[]> {
		const summaries: EmailMessageSummary[] = [];
		try {
			await withTimeout(
				timeoutMs,
				`IMAP ${path}`,
				openImap(async (client: ImapFlow) => {
					await client.mailboxOpen(path);
					const uids = (await client.search({ all: true }, { uid: true })) || [];
					// Gmail ignores uid-semantics on FETCH ranges (arrays are read as
					// sequence numbers), so map the newest uids to their sequence
					// positions and fetch those.
					const seqStart = Math.max(1, uids.length - LIST_FETCH_LIMIT + 1);
					const seqs = Array.from({ length: uids.length - seqStart + 1 }, (_v, i) => seqStart + i);
					if (seqs.length > 0) {
						for await (const message of client.fetch(seqs, { envelope: true })) {
							summaries.push(summaryFrom(message));
						}
					}
				}),
			);
		} catch (error) {
			throw new Error(`Could not list ${path}: ${emailErrorMessage(error)}`);
		}
		// Newest first.
		summaries.reverse();
		return summaries;
	}

	async function readMessage(uid: number): Promise<EmailMessage> {
		try {
			const result = await withTimeout(
				timeoutMs,
				"IMAP read",
				openImap(async (client) => {
					// Try INBOX first, then All Mail (archived messages live there). The
					// All Mail fallback is Gmail-specific: non-Gmail providers usually don't
					// have that folder, so skip it (rather than failing) when it is missing.
					let seq: number | undefined;
					for (const folder of ["INBOX", "[Gmail]/All Mail"]) {
						try {
							await client.mailboxOpen(folder);
						} catch (openError) {
							if (folder === "[Gmail]/All Mail") continue;
							throw openError;
						}
						seq = await sequenceOfUid(client, uid);
						if (seq !== undefined) break;
					}
					if (seq === undefined) return undefined;
					let message: FetchMessageObject | undefined;
					for await (const m of client.fetch([seq], { envelope: true, source: true })) {
						message = m;
					}
					if (!message) return undefined;
					const envelope = message.envelope;
					return {
						uid: message.uid,
						subject: (envelope?.subject ?? "").slice(0, MAX_SUBJECT_CHARS) || "(no subject)",
						from: fromAddress(envelope?.from?.[0]),
						to: fromAddress(envelope?.to?.[0]),
						date: envelope?.date ?? null,
						text: plainBody(message),
					};
				}),
			);
			if (!result) throw new Error(`Message ${uid} was not found in Inbox.`);
			return result;
		} catch (error) {
			if (error instanceof Error && error.message.includes("not found")) throw error;
			throw new Error(`Could not read message ${uid}: ${emailErrorMessage(error)}`);
		}
	}

	async function searchBySubject(subject: string): Promise<EmailMessageSummary[]> {
		const summaries: EmailMessageSummary[] = [];
		try {
			await withTimeout(
				timeoutMs,
				"IMAP search",
				openImap(async (client) => {
					await client.mailboxOpen("INBOX");
					const uids = (await client.search({ subject }, { uid: true })) || [];
					if (uids.length > 0) {
						// Sequence-map the matched uids (Gmail ignores uid FETCH ranges).
						const seqs = await sequencesOfUids(client, uids);
						for await (const message of client.fetch(seqs, { envelope: true })) {
							summaries.push(summaryFrom(message));
						}
					}
				}),
			);
		} catch (error) {
			throw new Error(`Could not search for "${subject}": ${emailErrorMessage(error)}`);
		}
		summaries.reverse();
		return summaries;
	}

	/** Compose the raw RFC822 bytes for a plain-text message using nodemailer. */
	async function composeRaw(to: string, subject: string, body: string): Promise<{ raw: Buffer; messageId: string }> {
		requirePass();
		// streamTransport builds the encoded message without sending it.
		const transporter = getNodemailer().createTransport({ streamTransport: true, buffer: true });
		const info = await transporter.sendMail({
			from: config.user,
			to,
			subject: subject || "(no subject)",
			text: body || "",
		});
		if (!Buffer.isBuffer(info.message)) {
			throw new Error("Could not compose the draft message.");
		}
		return { raw: info.message, messageId: info.messageId ?? "" };
	}

	async function draft(to: string, subject: string, body: string): Promise<EmailDraftResult> {
		try {
			const { raw, messageId } = await composeRaw(to, subject, body);
			const draftId = await withTimeout(
				timeoutMs,
				"IMAP save draft",
				openImap(async (client) => {
					await client.mailboxOpen(config.draftsFolder);
					const response = await client.append(config.draftsFolder, raw, ["\\Draft"]);
					if (response && typeof response.uid === "number") return response.uid;
					return undefined;
				}),
			);
			if (draftId === undefined) {
				throw new Error("Draft was saved but its id could not be resolved.");
			}
			return { draftId, messageId };
		} catch (error) {
			if (error instanceof Error && error.message.includes("id could not be resolved")) throw error;
			throw new Error(`Could not save draft: ${emailErrorMessage(error)}`);
		}
	}

	async function send(draftId: number): Promise<EmailSendResult> {
		try {
			const source = await withTimeout(
				timeoutMs,
				"IMAP read draft",
				openImap(async (client) => {
					await client.mailboxOpen(config.draftsFolder);
					const seq = await sequenceOfUid(client, draftId);
					if (seq === undefined) return undefined;
					let source: string | undefined;
					for await (const message of client.fetch([seq], { source: true })) {
						source = Buffer.isBuffer(message.source) ? message.source.toString("utf-8") : undefined;
					}
					return source;
				}),
			);
			if (source === undefined) throw new Error(`Draft ${draftId} was not found or has no body.`);

			requirePass();
			await withTimeout(
				timeoutMs,
				"SMTP send",
				(async () => {
					const transporter = getNodemailer().createTransport({
						host: config.host,
						port: config.port,
						secure: config.secure,
						auth: { user: config.user, pass: config.pass ?? "" },
					});
					try {
						await transporter.sendMail({ raw: source });
					} finally {
						transporter.close();
					}
				})(),
			);

			// Move the sent draft out of Drafts (best-effort).
			try {
				await withTimeout(
					timeoutMs,
					"IMAP move sent",
					openImap(async (client) => {
						await client.mailboxOpen(config.draftsFolder);
						await client.messageFlagsAdd({ uid: draftId }, ["\\Seen"], { uid: true });
						await client.messageMove({ uid: draftId }, config.sentFolder, { uid: true });
					}),
				);
			} catch {
				// Sending already succeeded; leaving the draft is acceptable.
			}

			return { messageId: "" };
		} catch (error) {
			if (error instanceof Error && error.message.includes("not found")) throw error;
			throw new Error(`Could not send draft ${draftId}: ${emailErrorMessage(error)}`);
		}
	}

	async function folderCounts(): Promise<EmailFolderCounts[]> {
		const wanted = new Set([
			normalizeFolderPath("INBOX"),
			normalizeFolderPath(config.draftsFolder),
			normalizeFolderPath(config.sentFolder),
		]);
		try {
			const boxes = await withTimeout(
				timeoutMs,
				"IMAP list",
				openImap(async (client) => {
					return (await client.list()) as ListResponse[];
				}),
			);
			const counts: EmailFolderCounts[] = [];
			for (const box of boxes) {
				if (wanted.has(normalizeFolderPath(box.path))) {
					// Separate short-lived connection per folder to keep state isolated.
					const total = await withTimeout(
						timeoutMs,
						`IMAP ${box.path}`,
						openImap(async (client) => {
							const mailbox = await client.mailboxOpen(box.path);
							return mailbox.exists ?? 0;
						}),
					);
					counts.push({ path: box.path, total });
				}
			}
			return counts;
		} catch (error) {
			throw new Error(`Could not read folder status: ${emailErrorMessage(error)}`);
		}
	}

	return {
		async listInbox() {
			return listFolder("INBOX");
		},
		async listDrafts() {
			return listFolder(config.draftsFolder);
		},
		async listSent() {
			return listFolder(config.sentFolder);
		},
		searchBySubject,
		readMessage,
		draft,
		send,
		folderCounts,
		async connect() {
			// Credential/basic-connectivity probe.
			await withTimeout(
				timeoutMs,
				"IMAP connect",
				openImap(async () => {}),
			);
		},
	};
}

/** Case-insensitive, slash/normalized folder path comparison helper. */
function normalizeFolderPath(path: string): string {
	return path.replace(/[/\\]/g, "/").toLowerCase();
}
