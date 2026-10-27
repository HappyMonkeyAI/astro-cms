/**
 * Runtime-configured database and storage for EmDash on Node.
 *
 * EmDash serialises the `database` and `storage` config into the build output, so
 * `postgres({ connectionString: process.env.DATABASE_URL })` either bakes the password
 * into `dist/` or silently drops it (spike F1, F3). These descriptors only carry the
 * *names* of environment variables; our entrypoints read the values when the server
 * starts and delegate to EmDash's own adapters.
 *
 * @example
 * ```js
 * emdash({ database: postgresFromEnv(), storage: localFromEnv() });
 * ```
 */

import { postgres } from "emdash/db";

import { assertEnvName, type PostgresRuntimeConfig, type LocalRuntimeConfig } from "./shared.ts";

export type { PostgresRuntimeConfig, LocalRuntimeConfig };

export interface PostgresFromEnvOptions {
	/** Environment variable holding the connection string. @default "DATABASE_URL" */
	env?: string;
	pool?: PostgresRuntimeConfig["pool"];
	ssl?: PostgresRuntimeConfig["ssl"];
}

export function postgresFromEnv(options: PostgresFromEnvOptions = {}) {
	const env = assertEnvName(options.env ?? "DATABASE_URL");
	// Reuse EmDash's descriptor so migrations and the manifest stay identical; the
	// migration runner already reads the connection string from `env` at runtime.
	const base = postgres({ connectionString: "", migrationConnectionStringEnv: env });
	const config: PostgresRuntimeConfig = { connectionStringEnv: env, pool: options.pool, ssl: options.ssl };
	return { ...base, entrypoint: "@astro-cms/runtime-config/db/postgres", config };
}

export interface LocalFromEnvOptions {
	/** Environment variable holding the upload directory. @default "UPLOADS_DIR" */
	env?: string;
	/** Directory used when the variable is unset. @default "./uploads" */
	defaultDirectory?: string;
	/** Public URL prefix for stored files. @default "/_emdash/api/media/file" */
	baseUrl?: string;
}

export function localFromEnv(options: LocalFromEnvOptions = {}) {
	const config: LocalRuntimeConfig = {
		directoryEnv: assertEnvName(options.env ?? "UPLOADS_DIR"),
		defaultDirectory: options.defaultDirectory ?? "./uploads",
		baseUrl: options.baseUrl ?? "/_emdash/api/media/file",
	};
	return { entrypoint: "@astro-cms/runtime-config/storage/local", config };
}
