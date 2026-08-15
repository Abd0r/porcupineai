import { describe, expect, it } from "vitest";
import { extractVoiceFileId, isVoiceMessage, TelegramBridge } from "../src/porcupine/telegram-bridge.ts";

/**
 * Mock fetch for the Telegram voice-note flow. `getUpdates`/`getFile`/BOT-call
 * POSTs return JSON; the file-download URL (`.../file/bot...`) returns raw
 * bytes via arrayBuffer() so downloadVoiceFile receives real audio bytes.
 */
function createVoiceFetchMock(opts: { filePath?: string; fileBytes?: Buffer; status?: number } = {}) {
	const filePath = opts.filePath ?? "voice/file.ogg";
	const fileBytes = opts.fileBytes ?? Buffer.from("fake-ogg-bytes");
	const status = opts.status ?? 200;
	const calls: Array<{ url: string; method: string; body: string }> = [];
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		const full = String(url);
		const call = { url: full, method: init?.method ?? "GET", body: String(init?.body ?? "") };
		calls.push(call);
		if (full.includes("/file/bot")) {
			// File download endpoint.
			return {
				ok: status < 400,
				status,
				arrayBuffer: async () => (status < 400 ? fileBytes : new ArrayBuffer(0)),
				json: async () => ({}),
			} as unknown as Response;
		}
		// JSON API endpoint.
		const method = full.split("/").pop() ?? "";
		const result = method === "getFile" ? { ok: true, result: { file_path: filePath } } : { ok: true, result: [] };
		return { ok: true, status: 200, json: async () => result } as unknown as Response;
	};
	return { fetchImpl, calls };
}

function decoded(body: string): string {
	return decodeURIComponent(body).replace(/\+/g, " ");
}

function voiceMessage(chatId: number, fileId = "voice-file-1"): Record<string, unknown> {
	return {
		update_id: 1,
		message: {
			message_id: 1,
			chat: { id: chatId, type: "private" },
			from: { id: chatId },
			voice: { duration: 2, file_id: fileId },
		},
	};
}

function audioMessage(chatId: number, fileId = "audio-file-1"): Record<string, unknown> {
	return {
		update_id: 2,
		message: {
			message_id: 2,
			chat: { id: chatId, type: "private" },
			from: { id: chatId },
			audio: { duration: 3, file_id: fileId },
		},
	};
}

const ALLOWED = 111;

function makeBridge(fetchImpl: typeof fetch, transcribe?: (audio: Buffer) => Promise<string>) {
	const prompts: string[] = [];
	const bridge = new TelegramBridge({
		token: "test-token",
		allowlist: [ALLOWED],
		prompt: async (text) => {
			prompts.push(text);
		},
		confirmTui: async () => false,
		getStatus: () => "",
		transcribeAudio: transcribe ?? (async () => "turn the lights on"),
		fetchImpl,
	});
	return { bridge, prompts };
}

/** Type-escape for calling the private message handler directly. */
function internals(bridge: TelegramBridge): {
	handleMessage(message: unknown): Promise<void>;
	pendingTelegram: Array<{ chatId: number; userId?: number; text: string }>;
} {
	return bridge as unknown as ReturnType<typeof internals>;
}

describe("voice-message detection", () => {
	it("detects Telegram voice and audio attachments", () => {
		expect(isVoiceMessage(voiceMessage(1).message)).toBe(true);
		expect(isVoiceMessage(audioMessage(1).message)).toBe(true);
		expect(isVoiceMessage({ message_id: 1, chat: { id: 1 }, text: "hi" })).toBe(false);
		expect(isVoiceMessage({ message_id: 1, chat: { id: 1 }, photo: [{}] })).toBe(false);
	});

	it("extracts the file_id from voice and audio, preferring voice", () => {
		expect(extractVoiceFileId(voiceMessage(1, "vid-1").message)).toBe("vid-1");
		expect(extractVoiceFileId(audioMessage(1, "aid-1").message)).toBe("aid-1");
		expect(extractVoiceFileId({ voice: { file_id: "v" }, audio: { file_id: "a" } })).toBe("v");
		expect(extractVoiceFileId({ chat: { id: 1 }, text: "hi" })).toBeUndefined();
		expect(extractVoiceFileId({ voice: {} })).toBeUndefined();
	});
});

describe("voice-note transcription flow", () => {
	it("submits the transcription as a prompt through the same path as text", async () => {
		const { fetchImpl } = createVoiceFetchMock({ fileBytes: Buffer.from("audio-bytes") });
		const { bridge, prompts } = makeBridge(fetchImpl, async (audio) => {
			expect(audio.toString()).toBe("audio-bytes");
			return "turn the lights on";
		});
		await internals(bridge).handleMessage(voiceMessage(ALLOWED).message as never);
		expect(prompts).toEqual(["turn the lights on"]);
		expect(bridge.pendingTurns).toBe(1);
	});

	it("transcribes audio attachments too and trims the result", async () => {
		const { fetchImpl } = createVoiceFetchMock();
		const { bridge, prompts } = makeBridge(fetchImpl, async () => "  set the thermostat  ");
		await internals(bridge).handleMessage(audioMessage(ALLOWED).message as never);
		expect(prompts).toEqual(["set the thermostat"]);
	});

	it("downloaded file bytes flow through the configured getFile/file endpoint", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock({ filePath: "audio/sub.ogg" });
		const { bridge, prompts } = makeBridge(fetchImpl, async () => "ok");
		await internals(bridge).handleMessage(voiceMessage(ALLOWED, "f1").message as never);
		expect(prompts).toEqual(["ok"]);
		expect(calls.some((c) => c.url.includes("getFile") && c.body.includes("f1"))).toBe(true);
		const files = calls.filter((c) => c.url.includes("/file/bot"));
		expect(files.length).toBe(1);
		expect(files[0]?.url).toContain("audio/sub.ogg");
	});

	it("does not start a turn for non-audio attachment-only messages", async () => {
		const { fetchImpl } = createVoiceFetchMock();
		const { bridge, prompts } = makeBridge(fetchImpl);
		await internals(bridge).handleMessage({
			message_id: 3,
			chat: { id: ALLOWED, type: "private" },
			from: { id: ALLOWED },
			photo: [{ file_id: "p1" }],
		} as never);
		expect(prompts).toEqual([]);
		expect(bridge.pendingTurns).toBe(0);
	});
});

describe("voice-note error handling", () => {
	it("replies with a clear error when transcription fails and does not crash", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock();
		const { bridge, prompts } = makeBridge(fetchImpl, async () => {
			throw new Error("onnx runtime failed");
		});
		await internals(bridge).handleMessage(voiceMessage(ALLOWED).message as never);
		expect(prompts).toEqual([]);
		expect(bridge.pendingTurns).toBe(0);
		const send = calls.find((c) => c.url.includes("sendMessage"));
		expect(decoded(send?.body ?? "")).toContain("Voice transcription failed: onnx runtime failed");
	});

	it("replies when the file download fails instead of crashing", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock({ status: 404 });
		const { bridge, prompts } = makeBridge(fetchImpl);
		await internals(bridge).handleMessage(voiceMessage(ALLOWED).message as never);
		expect(prompts).toEqual([]);
		const send = calls.find((c) => c.url.includes("sendMessage"));
		expect(decoded(send?.body ?? "")).toContain("Voice transcription failed");
	});

	it("does not inject an empty prompt when transcription is a no-op", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock();
		const { bridge, prompts } = makeBridge(fetchImpl, async () => "");
		await internals(bridge).handleMessage(voiceMessage(ALLOWED).message as never);
		expect(prompts).toEqual([]);
		expect(bridge.pendingTurns).toBe(0);
		const send = calls.find((c) => c.url.includes("sendMessage"));
		expect(decoded(send?.body ?? "")).toContain("could not hear any speech");
	});

	it("rolls back the turn and notifies when the prompt call itself fails", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock();
		const prompts: string[] = [];
		const bridge = new TelegramBridge({
			token: "test-token",
			allowlist: [ALLOWED],
			prompt: async () => {
				prompts.push("thrown");
				throw new Error("agent busy");
			},
			confirmTui: async () => false,
			getStatus: () => "",
			transcribeAudio: async () => "some text",
			fetchImpl,
		});
		await internals(bridge).handleMessage(voiceMessage(ALLOWED).message as never);
		expect(bridge.pendingTurns).toBe(0);
		const send = calls.find((c) => c.url.includes("sendMessage"));
		expect(decoded(send?.body ?? "")).toContain("Could not start the task: agent busy");
	});

	it("ignores voice messages from chats not in the allowlist", async () => {
		const { fetchImpl, calls } = createVoiceFetchMock();
		const { bridge, prompts } = makeBridge(fetchImpl);
		await internals(bridge).handleMessage(voiceMessage(999).message as never);
		expect(prompts).toEqual([]);
		// No getFile/download attempts leak for unauthorized chats.
		expect(calls.some((c) => c.url.includes("getFile"))).toBe(false);
	});
});
