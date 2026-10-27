/**
 * Runtime entrypoint for `localFromEnv()`: resolves the upload directory from the
 * environment when EmDash creates storage, then delegates to EmDash's adapter.
 */

import { createStorage as createLocalStorage } from "emdash/storage/local";

import { readEnv, type LocalRuntimeConfig } from "../shared.ts";

export function resolveLocalConfig(config: LocalRuntimeConfig, env?: Record<string, string | undefined>) {
	return { directory: readEnv(config.directoryEnv, env) ?? config.defaultDirectory, baseUrl: config.baseUrl };
}

export function createStorage(config: LocalRuntimeConfig) {
	return createLocalStorage(resolveLocalConfig(config));
}
