import type { ProviderHeaders } from "../types.ts";

export function headersToRecord(headers: Headers): Record<string, string> {
	// The global Headers type can collapse to {} depending on the lib/type set
	// (@types/node's web-globals conditional on globalThis.onmessage): read
	// through a cast so this works under every type shape. Runtime is stable —
	// Headers always supports iteration.
	const entries = (headers as unknown as { entries?: () => IterableIterator<[string, string]> }).entries;
	const result: Record<string, string> = {};
	if (entries) {
		for (const [key, value] of entries.call(headers)) {
			result[key] = value;
		}
		return result;
	}
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

export function providerHeadersToRecord(headers: ProviderHeaders | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value !== null) result[key] = value;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
