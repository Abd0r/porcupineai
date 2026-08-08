import { APP_NAME } from "../config.ts";

export function getPorcupineUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `${APP_NAME}/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

/** @deprecated Use getPorcupineUserAgent; kept for import stability during the product rename. */
export const getProductUserAgent = getPorcupineUserAgent;
