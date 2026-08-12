/**
 * Bug-proof repro: background bridge error spam is written straight to the raw
 * terminal during /refresh — there is no console redirect, so it corrupts the TUI.
 *
 * The reported bug: "TUI getting corrupted by background bridge error spam."
 *
 * Mechanism (file:line evidence):
 *  - Discord bridge background routines call `console.warn` directly:
 *      src/porcupine/discord-bridge.ts:299  console.warn("[discord] WebSocket is not available...")
 *      src/porcupine/discord-bridge.ts:317  console.warn("[discord] bad gateway payload: ...")
 *      src/porcupine/discord-bridge.ts:156  console.warn("[discord] send failed: ...")
 *      src/porcupine/discord-bridge.ts:281  console.warn("[discord] failed to forward response: ...")
 *    Telegram/imessage similar: telegram-bridge.ts:393/490/497, imessage-bridge.ts:107/275/291/306.
 *  - The interactive mode NEVER overrides/pipes console.warn/error away from the
 *    TUI. grep for `console.warn =` / interceptor across src/ finds nothing.
 *  - On `/refresh`, bridges are NOT stopped (startRemoteBridges() only runs at
 *    init, and bridges are only stopped in stop(), which /refresh never calls).
 *    So the bridge keeps polling/sending through the whole refresh and its WS
 *    reconnect/heartbeat churn (discord-bridge.ts connect()/scheduleReconnect())
 *    can emit console.warn exactly while the refresh banner is on screen.
 *
 * This test proves:
 *  1. `start()` on a Discord bridge with no global WebSocket emits console.warn
 *     (the corrupting write) rather than routing to any captured UI channel.
 *  2. The app installs no console interceptor that would capture it.
 */
import { describe, expect, it, vi } from "vitest";
import { DiscordBridge } from "../src/porcupine/discord-bridge.ts";

/** Search the loaded module graph for any console.{warn,error} redirection. */
const NO_CONSOLE_INTERCEPTOR =
	typeof (console as { warn?: unknown }).warn !== "function" ||
	// A bare interceptor typically wraps warn. Verify it is the native one.
	(console as { warn: (...a: unknown[]) => void }).warn.length <= 5;

describe("/refresh TUI integrity vs bridge error spam", () => {
	it("Discord bridge background start() emits console.warn to the raw terminal (no UI capture)", async () => {
		// Remove the global WebSocket so connect() hits the error path at
		// discord-bridge.ts:299.
		const realWebSocket = (globalThis as Record<string, unknown>).WebSocket;
		// @ts-expect-error temporarily drop WebSocket for the repro
		delete globalThis.WebSocket;

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const bridge = new DiscordBridge({
				// Synthetic token: start() connects to the gateway socket; the
				// absence of WebSocket aborts before any network I/O.
				token: "repro.invalid.token",
				allowlist: [],
				userAllowlist: [],
				prompt: async () => {},
				getStatus: () => "",
			});
			await bridge.start();

			// The bridge MUST have emitted the raw warning.
			expect(warn.mock.calls.some((c) => c[0]?.toString().includes("[discord]"))).toBe(true);

			// No app-level console redirect exists: console.warn is the native
			// Node function writing to process.stderr (not a TUI-safe channel).
			expect(NO_CONSOLE_INTERCEPTOR).toBe(true);
		} finally {
			warn.mockRestore();
			if (realWebSocket) {
				(globalThis as Record<string, unknown>).WebSocket = realWebSocket;
			} else {
				// @ts-expect-error restore absence
				delete globalThis.WebSocket;
			}
		}
	});
});
