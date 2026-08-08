import type { JsonValue, ProtocolError, ProtocolErrorCode } from "@porcupineai/protocol";

export class PorcupineServerError extends Error {
	readonly code: ProtocolErrorCode;
	readonly details: JsonValue | undefined;

	constructor(error: ProtocolError) {
		super(error.message);
		this.name = "PorcupineServerError";
		this.code = error.code;
		this.details = error.details;
	}
}

export class PorcupineDisconnectedError extends Error {
	constructor(message = "Porcupine client is disconnected") {
		super(message);
		this.name = "PorcupineDisconnectedError";
	}
}

export class PorcupineClientDisposedError extends Error {
	constructor() {
		super("Porcupine client is disposed");
		this.name = "PorcupineClientDisposedError";
	}
}

export class PorcupineRequestTimeoutError extends Error {
	readonly command: string;
	readonly timeoutMs: number;

	constructor(command: string, timeoutMs: number) {
		super(`Porcupine request "${command}" timed out after ${timeoutMs}ms`);
		this.name = "PorcupineRequestTimeoutError";
		this.command = command;
		this.timeoutMs = timeoutMs;
	}
}

export class PorcupineSessionOwnershipError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string, message: string) {
		super(message);
		this.name = "PorcupineSessionOwnershipError";
		this.sessionId = sessionId;
	}
}

export class PorcupineSessionDetachedError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`Session ${sessionId} is not attached`);
		this.name = "PorcupineSessionDetachedError";
		this.sessionId = sessionId;
	}
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function toDisconnectedError(error: unknown): PorcupineDisconnectedError {
	const cause = toError(error);
	return cause instanceof PorcupineDisconnectedError ? cause : new PorcupineDisconnectedError(cause.message);
}
