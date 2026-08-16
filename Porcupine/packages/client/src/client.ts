import {
	type Command,
	type CommandResult,
	type EventEnvelope,
	encodeClientMessage,
	ProtocolValidationError,
	type ResponseEnvelope,
	type ResultForCommand,
	type ServerEvent,
	type ServerSnapshot,
	type SessionSummary,
} from "@porcupineai/protocol";
import { Connection } from "./connection.ts";
import {
	PorcupineClientDisposedError,
	PorcupineDisconnectedError,
	PorcupineRequestTimeoutError,
	PorcupineServerError,
	PorcupineSessionDetachedError,
	PorcupineSessionOwnershipError,
	toError,
} from "./errors.ts";
import { createPromiseResolvers } from "./promise.ts";
import {
	type AcquireSessionOptions,
	type PorcupineSessionHandle,
	SessionHandle,
	type SessionHandleCallbacks,
	type SessionLeaseMode,
} from "./session-handle.ts";
import { ClientState } from "./state.ts";
import type {
	ConnectionState,
	ConnectionStateChange,
	CreateSessionOptions,
	PorcupineClientOptions,
	Unsubscribe,
} from "./types.ts";

type SessionLeaseState = "active" | "releasing" | "released" | "invalidated";

interface SessionLeaseToken {
	readonly mode: SessionLeaseMode;
}

interface PendingRequest {
	command: Command;
	resolve(result: CommandResult): void;
	reject(error: Error): void;
	timeoutId?: NodeJS.Timeout;
}

export class PorcupineClient {
	readonly #options: PorcupineClientOptions;
	readonly #connection: Connection;
	readonly #state: ClientState;
	readonly #pendingRequests = new Map<string, PendingRequest>();
	readonly #timedOutRequestIds = new Set<string>();
	readonly #sessionLeaseCounts = new Map<string, number>();
	readonly #exclusiveSessionLeases = new Map<string, SessionLeaseToken>();
	readonly #sessionLeaseGenerations = new Map<string, number>();
	readonly #sessionAttachments = new Map<string, Promise<void>>();
	readonly #sessionDetachments = new Map<string, Promise<void>>();
	readonly #sessionCleanupRequired = new Set<string>();
	readonly #sessionReconciliations = new Map<string, Promise<void>>();
	readonly #connectionStateListeners = new Set<(change: ConnectionStateChange) => void>();
	#requestSequence = 0;
	#requestTimeoutMs(): number {
		return this.#options.requestTimeoutMs ?? 60_000;
	}

	#disposed = false;
	#disposePromise: Promise<void> | undefined;

	constructor(options: PorcupineClientOptions) {
		const requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
		if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
			throw new TypeError("PorcupineClient requestTimeoutMs must be a positive safe integer");
		}
		this.#options = options;
		this.#state = new ClientState(options.onListenerError);
		this.#connection = new Connection({
			token: options.token,
			transportFactory: options.transportFactory,
			maxFrameLength: options.maxFrameLength,
			onHandshake: (snapshot) => this.#state.applyServerSnapshot(snapshot),
			onMessage: (message) => this.#handleMessage(message),
			onStateChange: (change) => this.#handleConnectionStateChange(change),
		});
	}

	get disposed(): boolean {
		return this.#disposed;
	}

	get connectionState(): ConnectionState {
		return this.#connection.state;
	}

	get connected(): boolean {
		return this.#connection.state === "connected";
	}

	get snapshot(): ServerSnapshot | undefined {
		return this.#state.snapshot;
	}

	static async connect(options: PorcupineClientOptions): Promise<PorcupineClient> {
		const client = new PorcupineClient(options);
		try {
			await client.connect();
			return client;
		} catch (error) {
			await client.dispose();
			throw error;
		}
	}

	connect(): Promise<ServerSnapshot> {
		if (this.#disposed) return Promise.reject(new PorcupineClientDisposedError());
		if (this.#connection.state === "disconnected") this.#state.reset();
		return this.#connection.connect();
	}

	reconnect(): Promise<ServerSnapshot> {
		return this.connect();
	}

	disconnect(reason = "Client disconnected"): void {
		this.#connection.disconnect(reason);
	}

	subscribe(listener: (snapshot: ServerSnapshot) => void): Unsubscribe {
		this.#assertNotDisposed();
		return this.#state.subscribe(listener);
	}

	onEvent(listener: (event: ServerEvent) => void): Unsubscribe {
		this.#assertNotDisposed();
		return this.#state.onEvent(listener);
	}

	onConnectionStateChange(listener: (change: ConnectionStateChange) => void): Unsubscribe {
		this.#assertNotDisposed();
		this.#connectionStateListeners.add(listener);
		return () => this.#connectionStateListeners.delete(listener);
	}

	async listSessions(): Promise<readonly SessionSummary[]> {
		return (await this.#request({ command: "list" })).sessions;
	}

	async createSession(options: CreateSessionOptions = {}): Promise<PorcupineSessionHandle> {
		const result = await this.#request({ command: "create", ...options });
		const token = this.#reserveSessionLease(result.session.id, "exclusive");
		return this.#createSessionLease(result.session.id, token);
	}

	async attachSession(sessionId: string): Promise<PorcupineSessionHandle> {
		return this.acquireSession(sessionId, { mode: "shared" });
	}

	async acquireSession(sessionId: string, options: AcquireSessionOptions): Promise<PorcupineSessionHandle> {
		this.#assertNotDisposed();
		const token = this.#reserveSessionLease(sessionId, options.mode);
		try {
			const detachment = this.#sessionDetachments.get(sessionId);
			if (detachment) await detachment.catch(() => {});
			const reconciled = this.#sessionCleanupRequired.has(sessionId)
				? await this.#reconcileSessionCleanup(sessionId)
				: false;
			if (reconciled || !this.#state.isSessionAttached(sessionId)) {
				let attachment = this.#sessionAttachments.get(sessionId);
				if (!attachment) {
					attachment = this.#attachSession(sessionId);
					this.#sessionAttachments.set(sessionId, attachment);
				}
				try {
					await attachment;
				} finally {
					if (this.#sessionAttachments.get(sessionId) === attachment) this.#sessionAttachments.delete(sessionId);
				}
			}
			return this.#createSessionLease(sessionId, token);
		} catch (error) {
			this.#releaseSessionLease(sessionId, token);
			throw error;
		}
	}

	async #attachSession(sessionId: string): Promise<void> {
		const previous = this.#state.forgetSessionSnapshot(sessionId);
		try {
			await this.#request({ command: "attach", sessionId });
		} catch (error) {
			if (previous) this.#state.restoreSessionSnapshot(previous);
			throw error;
		}
	}

	#request<const TCommand extends Command>(command: TCommand): Promise<ResultForCommand<TCommand>> {
		if (this.#disposed) return Promise.reject(new PorcupineClientDisposedError());
		if (!this.connected) return Promise.reject(new PorcupineDisconnectedError());
		const id = `request-${++this.#requestSequence}`;
		const { promise, resolve, reject } = createPromiseResolvers<CommandResult>();
		const timeoutId = setTimeout(() => {
			const timedOut = this.#takePendingRequest(id);
			timedOut?.reject(new PorcupineRequestTimeoutError(command.command, this.#requestTimeoutMs()));
			if (timedOut) this.#timedOutRequestIds.add(id);
		}, this.#requestTimeoutMs());
		// Never pin the event loop: the harness shares this process with the TUI,
		// and an unref'd timer is cleared on response/disconnect anyway.
		timeoutId.unref?.();
		this.#pendingRequests.set(id, { command, resolve, reject, timeoutId });
		let frame: Uint8Array;
		try {
			frame = encodeClientMessage(
				{ type: "request", id, request: command },
				{ maxFrameLength: this.#connection.maxFrameLength },
			);
		} catch (error) {
			this.#takePendingRequest(id)?.reject(toError(error));
			return promise as Promise<ResultForCommand<TCommand>>;
		}
		try {
			this.#connection.send(frame);
		} catch (error) {
			// A disconnect can land between the `connected` check and send: reject
			// the pending entry (and its timer) instead of leaking it for a timeout.
			this.#takePendingRequest(id)?.reject(toError(error));
		}
		return promise as Promise<ResultForCommand<TCommand>>;
	}

	#createSessionLease(sessionId: string, token: SessionLeaseToken): PorcupineSessionHandle {
		const generation = this.#sessionLeaseGenerations.get(sessionId) ?? 0;
		this.#sessionLeaseGenerations.set(sessionId, generation);
		let state: SessionLeaseState = "active";
		let releasePromise: Promise<void> | undefined;
		const refreshState = () => {
			if (
				(state === "active" || state === "releasing") &&
				this.#sessionLeaseGenerations.get(sessionId) !== generation
			) {
				state = "invalidated";
			}
		};
		const isActive = () => {
			refreshState();
			return state === "active" && this.#state.isSessionAttached(sessionId);
		};
		const assertActive = () => {
			this.#assertNotDisposed();
			if (!this.connected) throw new PorcupineDisconnectedError();
			if (!isActive()) throw new PorcupineSessionDetachedError(sessionId);
		};
		const release = (relinquishOnFailure: boolean): Promise<void> => {
			refreshState();
			if (state === "released" || state === "invalidated") return Promise.resolve();
			if (releasePromise) return releasePromise;
			assertActive();
			state = "releasing";
			releasePromise = (async () => {
				const count = this.#sessionLeaseCounts.get(sessionId) ?? 0;
				if (count <= 1) {
					const detachment = this.#request({ command: "detach", sessionId }).then(() => undefined);
					this.#sessionDetachments.set(sessionId, detachment);
					try {
						await detachment;
						this.#releaseSessionLease(sessionId, token);
					} finally {
						if (this.#sessionDetachments.get(sessionId) === detachment) {
							this.#sessionDetachments.delete(sessionId);
						}
					}
				} else {
					this.#releaseSessionLease(sessionId, token);
				}
				state = "released";
			})().catch((error: unknown) => {
				refreshState();
				if (state === "invalidated") return;
				if (relinquishOnFailure) {
					this.#releaseSessionLease(sessionId, token);
					this.#sessionCleanupRequired.add(sessionId);
					state = "released";
				} else {
					state = "active";
					releasePromise = undefined;
				}
				throw error;
			});
			return releasePromise;
		};
		const callbacks: SessionHandleCallbacks = {
			isAttached: isActive,
			getSnapshot: () => (isActive() ? this.#state.getSessionSnapshot(sessionId) : undefined),
			subscribe: (listener) => {
				assertActive();
				return this.#state.subscribeSession(sessionId, (snapshot) => {
					if (isActive()) listener(snapshot);
				});
			},
			onEvent: (listener) => {
				assertActive();
				return this.#state.onSessionEvent(sessionId, (event) => {
					if (isActive() || event.type === "session_removed") listener(event);
				});
			},
			detach: () => release(false),
			dispose: () => release(true),
			request: (command) => {
				assertActive();
				return this.#request(command);
			},
		};
		return new SessionHandle(sessionId, callbacks);
	}

	#handleMessage(message: ResponseEnvelope | EventEnvelope): void {
		if (message.type === "event") {
			if (message.event.type === "session_removed") this.#invalidateSessionLeases(message.event.sessionId);
			this.#state.applyEvent(message.event);
			return;
		}
		const pending = this.#takePendingRequest(message.id);
		if (!pending) {
			// A response for a request that already timed out is a stale/duplicate from a
			// busy server, not a protocol violation. Drop it instead of tearing down the
			// whole connection (which would reject every other in-flight request).
			if (this.#timedOutRequestIds.delete(message.id)) return;
			this.#connection.fail(new ProtocolValidationError("Response has no matching request"));
			return;
		}
		if (!message.ok) {
			pending.reject(new PorcupineServerError(message.error));
			return;
		}
		if (message.result.command !== pending.command.command) {
			const error = new ProtocolValidationError(
				`Response command ${message.result.command} does not match ${pending.command.command}`,
			);
			pending.reject(error);
			this.#connection.fail(error);
			return;
		}
		this.#state.applyResult(message.result);
		pending.resolve(message.result);
	}

	#handleConnectionStateChange(change: ConnectionStateChange): void {
		if (change.state === "disconnected") {
			this.#state.clearAttachments();
			this.#invalidateAllSessionLeases();
			// Timed-out request ids no longer need stale-response tracking once the
			// connection is gone.
			this.#timedOutRequestIds.clear();
			this.#rejectPendingRequests(change.error ?? new PorcupineDisconnectedError());
		}
		this.#notifyConnectionStateListeners(change);
	}

	#takePendingRequest(id: string): PendingRequest | undefined {
		const request = this.#pendingRequests.get(id);
		if (request) {
			this.#pendingRequests.delete(id);
			if (request.timeoutId) clearTimeout(request.timeoutId);
		}
		return request;
	}

	#rejectPendingRequests(error: Error): void {
		const requests = [...this.#pendingRequests.values()];
		this.#pendingRequests.clear();
		for (const request of requests) {
			if (request.timeoutId) clearTimeout(request.timeoutId);
			request.reject(error);
		}
	}

	dispose(): Promise<void> {
		if (this.#disposePromise) return this.#disposePromise;
		this.#disposed = true;
		this.#disposePromise = Promise.resolve();
		const error = new PorcupineClientDisposedError();
		this.#rejectPendingRequests(error);
		this.#connection.disconnect(error);
		this.#state.dispose();
		this.#invalidateAllSessionLeases();
		this.#connectionStateListeners.clear();
		return this.#disposePromise;
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.dispose();
	}

	#assertNotDisposed(): void {
		if (this.#disposed) throw new PorcupineClientDisposedError();
	}

	async #reconcileSessionCleanup(sessionId: string): Promise<boolean> {
		if (!this.#sessionCleanupRequired.has(sessionId)) return false;
		let reconciliation = this.#sessionReconciliations.get(sessionId);
		if (!reconciliation) {
			reconciliation = this.#request({ command: "detach", sessionId })
				.then(() => undefined)
				.then(() => {
					this.#sessionCleanupRequired.delete(sessionId);
				})
				.finally(() => {
					this.#sessionReconciliations.delete(sessionId);
				});
			this.#sessionReconciliations.set(sessionId, reconciliation);
		}
		await reconciliation;
		return true;
	}

	#reserveSessionLease(sessionId: string, mode: SessionLeaseMode): SessionLeaseToken {
		const count = this.#sessionLeaseCounts.get(sessionId) ?? 0;
		if (mode === "exclusive" && count > 0) {
			throw new PorcupineSessionOwnershipError(sessionId, `Session ${sessionId} already has an active lease`);
		}
		if (mode === "shared" && this.#exclusiveSessionLeases.has(sessionId)) {
			throw new PorcupineSessionOwnershipError(sessionId, `Session ${sessionId} has an exclusive lease`);
		}
		const token: SessionLeaseToken = { mode };
		this.#sessionLeaseCounts.set(sessionId, count + 1);
		if (mode === "exclusive") this.#exclusiveSessionLeases.set(sessionId, token);
		return token;
	}

	#releaseSessionLease(sessionId: string, token: SessionLeaseToken): void {
		const count = this.#sessionLeaseCounts.get(sessionId) ?? 0;
		if (count <= 1) this.#sessionLeaseCounts.delete(sessionId);
		else this.#sessionLeaseCounts.set(sessionId, count - 1);
		if (this.#exclusiveSessionLeases.get(sessionId) === token) this.#exclusiveSessionLeases.delete(sessionId);
	}

	#invalidateSessionLeases(sessionId: string): void {
		this.#sessionLeaseCounts.delete(sessionId);
		this.#exclusiveSessionLeases.delete(sessionId);
		this.#sessionCleanupRequired.delete(sessionId);
		this.#sessionLeaseGenerations.set(sessionId, (this.#sessionLeaseGenerations.get(sessionId) ?? 0) + 1);
	}

	#invalidateAllSessionLeases(): void {
		for (const sessionId of this.#sessionLeaseCounts.keys()) this.#invalidateSessionLeases(sessionId);
		this.#sessionCleanupRequired.clear();
	}

	#notifyConnectionStateListeners(change: ConnectionStateChange): void {
		for (const listener of this.#connectionStateListeners) {
			try {
				listener(change);
			} catch (error) {
				this.#reportListenerError(error);
			}
		}
	}

	#reportListenerError(error: unknown): void {
		if (!this.#options.onListenerError) return;
		try {
			this.#options.onListenerError(toError(error));
		} catch {
			// Diagnostics cannot affect protocol or transport state.
		}
	}
}
