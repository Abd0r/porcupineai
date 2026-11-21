import { describe, expect, it } from "vitest";
import { COMMAND_SURFACE_REQUIREMENTS } from "../src/core/surface-contract.ts";
import { adaptSessionToServeApi } from "../src/modes/serve-mode.ts";
import { startServeApi } from "../src/server/http-api.ts";
import { createHarness } from "./test-harness.ts";

describe("authenticated GUI contract API", () => {
	it("exposes real contract metadata and rejects unwired actions without recording success", async () => {
		const h = await createHarness();
		const api = adaptSessionToServeApi(h.session, h.tempDir);
		const server = await startServeApi({ session: api, port: 0, token: "parity-test" });
		const path = `http://127.0.0.1:${server.port()}/session/${api.id}`;
		const headers = { authorization: "Bearer parity-test", "content-type": "application/json" };
		try {
			expect((await fetch(`${path}/commands`)).status).toBe(401);
			const response = await fetch(`${path}/commands`, { headers });
			const catalog = (await response.json()) as {
				commands: Array<{ name: string; parity: string; acceptance: string }>;
			};
			for (const rule of COMMAND_SURFACE_REQUIREMENTS)
				expect(catalog.commands.find((item) => item.name === rule.name)).toMatchObject({
					parity: rule.parity,
					acceptance: rule.acceptance,
				});
			for (const rule of COMMAND_SURFACE_REQUIREMENTS.filter((item) => item.implementation === "missing")) {
				const result = await fetch(`${path}/command`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: `/${rule.name}` }),
				});
				expect(result.status, rule.name).toBe(501);
				expect(await result.json()).toMatchObject({ error: expect.stringContaining("not wired in the GUI") });
			}
			expect(api.getTimeline?.()).toEqual([]);
			const mcpPrompt = await fetch(`${path}/command`, {
				method: "POST",
				headers,
				body: JSON.stringify({ text: "/mcpp:review/check" }),
			});
			expect(mcpPrompt.status).toBe(501);
			const clientOnly = await fetch(`${path}/command`, {
				method: "POST",
				headers,
				body: JSON.stringify({ text: "/new" }),
			});
			expect(clientOnly.status).toBe(400);
			const inspection = await fetch(`${path}/command`, {
				method: "POST",
				headers,
				body: JSON.stringify({ text: "/parity" }),
			});
			expect(inspection.status).toBe(200);
			expect(await inspection.json()).toMatchObject({
				parity: { version: 1, ready: false },
				text: expect.stringContaining("not complete"),
			});
			expect(api.getTimeline?.()).toEqual([expect.objectContaining({ type: "command_result", command: "/parity" })]);
			expect(h.faux.callCount).toBe(0);
		} finally {
			await server.close();
			h.cleanup();
		}
	});
});
