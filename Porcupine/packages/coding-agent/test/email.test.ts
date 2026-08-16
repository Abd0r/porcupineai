import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
	createEmailClient,
	type EmailClient,
	type EmailDraftResult,
	type EmailFolderCounts,
	type EmailMessage,
	type EmailMessageSummary,
	type EmailSendResult,
	extractTextBody,
} from "../src/porcupine/email.ts";
import { buildEmailCommandOutput, parseEmailCommand } from "../src/porcupine/email-command.ts";

function summary(overrides: Partial<EmailMessageSummary> = {}): EmailMessageSummary {
	return { uid: 1, subject: "Hello", from: "Alice <alice@example.com>", date: new Date(), ...overrides };
}

function fakeClient(overrides: Partial<EmailClient> = {}): EmailClient {
	return {
		listInbox: vi.fn(async () => [summary({ uid: 1, subject: "Inbox msg" })]),
		listDrafts: vi.fn(async () => [summary({ uid: 7, subject: "Draft msg" })]),
		listSent: vi.fn(async () => [summary({ uid: 2, subject: "Sent msg" })]),
		searchBySubject: vi.fn(async () => [summary({ uid: 3, subject: "Found" })]),
		readMessage: vi.fn(
			async (): Promise<EmailMessage> => ({
				uid: 1,
				subject: "Inbox msg",
				from: "Alice <alice@example.com>",
				to: "me@example.com",
				date: new Date(),
				text: "body text",
			}),
		),
		draft: vi.fn(async (): Promise<EmailDraftResult> => ({ draftId: 99, messageId: "<draft-99>" })),
		send: vi.fn(async (): Promise<EmailSendResult> => ({ messageId: "<sent-100>" })),
		folderCounts: vi.fn(async (): Promise<EmailFolderCounts[]> => [{ path: "INBOX", total: 12 }]),
		connect: vi.fn(async () => {}),
		...overrides,
	} as EmailClient;
}

const connectInfo = { host: "imap.example.com", user: "me@example.com", draftsFolder: "Drafts", sentFolder: "Sent" };

describe("parseEmailCommand", () => {
	it("parses the bare /email as status", () => {
		expect(parseEmailCommand("/email")).toEqual({ kind: "status" });
		expect(parseEmailCommand("/email status")).toEqual({ kind: "status" });
	});

	it("parses listings", () => {
		expect(parseEmailCommand("/email inbox")).toEqual({ kind: "inbox" });
		expect(parseEmailCommand("/email drafts")).toEqual({ kind: "drafts" });
	});

	it("parses read and send with ids", () => {
		expect(parseEmailCommand("/email read 42")).toEqual({ kind: "read", id: 42 });
		expect(parseEmailCommand("/email send 7")).toEqual({ kind: "send", draftId: 7 });
	});

	it("parses draft with flags", () => {
		expect(parseEmailCommand('/email draft --to a@b.c --subject "Hi there" --body "Yo"')).toEqual({
			kind: "draft",
			to: "a@b.c",
			subject: "Hi there",
			body: "Yo",
		});
	});

	it("returns null for non-email commands", () => {
		expect(parseEmailCommand("/usage")).toBeNull();
		expect(parseEmailCommand("hello")).toBeNull();
	});

	it("returns invalid for unknown verbs", () => {
		const result = parseEmailCommand("/email bogus");
		expect(result?.kind).toBe("invalid");
	});
});

describe("buildEmailCommandOutput", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns the unconfigured message when email is not set up", async () => {
		const out = await buildEmailCommandOutput(
			{ kind: "status" },
			{
				configured: false,
				getClient: () => fakeClient(),
				unconfiguredMessage: "Email not configured.",
			},
		);
		expect(out).toBe("Email not configured.");
	});

	it("status reports user@host and folder counts, never the password", async () => {
		const client = fakeClient();
		const out = await buildEmailCommandOutput(
			{ kind: "status" },
			{
				configured: true,
				connectInfo,
				getClient: () => client,
			},
		);
		expect(out).toContain("me@example.com @ imap.example.com");
		expect(out).toContain("INBOX: 12 messages");
		expect(out).not.toContain("pass");
		expect(out).not.toContain("secret");
	});

	it("drafts lists draft messages", async () => {
		const client = fakeClient();
		const out = await buildEmailCommandOutput(
			{ kind: "drafts" },
			{
				configured: true,
				connectInfo,
				getClient: () => client,
			},
		);
		expect(out).toContain("Draft msg");
	});

	it("read renders a message body", async () => {
		const out = await buildEmailCommandOutput(
			{ kind: "read", id: 1 },
			{
				configured: true,
				connectInfo,
				getClient: () => fakeClient(),
			},
		);
		expect(out).toContain("Inbox msg");
		expect(out).toContain("body text");
	});

	it("send reports the ack", async () => {
		const out = await buildEmailCommandOutput(
			{ kind: "send", draftId: 7 },
			{
				configured: true,
				connectInfo,
				getClient: () => fakeClient(),
			},
		);
		expect(out).toContain("sent");
	});

	it("client errors become readable one-liners, not stack traces", async () => {
		const client = fakeClient({
			readMessage: vi.fn(async () => {
				throw new Error("boom: connection refused");
			}),
		});
		const out = await buildEmailCommandOutput(
			{ kind: "read", id: 1 },
			{
				configured: true,
				connectInfo,
				getClient: () => client,
			},
		);
		expect(out).toContain("Could not read message 1");
		expect(out).toContain("connection refused");
		expect(out).not.toContain("at ");
	});
});

describe("createEmailClient IMAP timeout aborts the underlying op", () => {
	const cacheKey = createRequire(import.meta.url).resolve("imapflow");
	// Force-load the real module into the CommonJS require cache (keyed by the
	// same resolved path email.ts will hit), so we can safely override it and
	// restore it afterwards.
	const original = require(cacheKey);

	afterEach(() => {
		// Restore the real imapflow module for any later tests in the run.
		require.cache[cacheKey]!.exports = original;
		vi.restoreAllMocks();
	});

	it("tears down the socket (close) instead of hanging logout when connect stalls", async () => {
		const closes = vi.fn();
		const fakeImapFlow = {
			ImapFlow: class {
				connect(): Promise<void> {
					// Never resolves — simulates a network stall.
					return new Promise(() => {});
				}
				logout(): Promise<void> {
					return new Promise(() => {}); // would hang forever if awaited
				}
				close(): void {
					closes();
				}
			},
		};
		require.cache[cacheKey]!.exports = fakeImapFlow;

		const client = createEmailClient({
			host: "imap.example.com",
			port: 993,
			secure: true,
			user: "me@example.com",
			draftsFolder: "Drafts",
			sentFolder: "Sent",
			timeoutMs: 50,
		});

		// The connect must settle (reject with a timeout) rather than hang, and the
		// hung socket is torn down via close() — not left leaking.
		await expect(client.connect()).rejects.toThrow(/timed out/);
		expect(closes).toHaveBeenCalled();
	});
});

describe("extractTextBody", () => {
	it("extracts a plain body", () => {
		const raw = "Subject: Hi\r\nFrom: a@b.c\r\n\r\nHello world\r\n";
		expect(extractTextBody(raw)).toBe("Hello world");
	});

	it("extracts the first text/plain part of a multipart message", () => {
		const raw = [
			"From: a@b.c",
			"Content-Type: multipart/alternative; boundary=abc",
			"",
			"--abc",
			"Content-Type: text/plain",
			"",
			"plain part",
			"--abc",
			"Content-Type: text/html",
			"",
			"<p>html <b>part</b></p>",
			"--abc--",
			"",
		].join("\r\n");
		expect(extractTextBody(raw)).toBe("plain part");
	});

	it("downgrades HTML to text when no plain part exists", () => {
		const raw = [
			"From: a@b.c",
			"Content-Type: text/html",
			"",
			"<html><body><p>Hi <b>there</b></p></body></html>",
		].join("\r\n");
		expect(extractTextBody(raw)).toBe("Hi there");
	});

	it("handles base64 transfer encoding", () => {
		const raw = `Subject: x\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("encoded body").toString("base64")}`;
		expect(extractTextBody(raw)).toBe("encoded body");
	});

	it("returns a placeholder for missing bodies", () => {
		expect(extractTextBody(undefined)).toBe("(no text body)");
		expect(extractTextBody("From: a@b.c\r\n\r\n   ")).toBe("(no text body)");
	});
});
