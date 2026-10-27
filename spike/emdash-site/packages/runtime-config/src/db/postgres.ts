/**
 * Runtime entrypoint for `postgresFromEnv()`: resolves the connection string from the
 * environment when EmDash creates the dialect, then delegates to EmDash's adapter.
 */

import { createDialect as createPostgresDialect } from "emdash/db/postgres";

import { readEnv, type PostgresRuntimeConfig } from "../shared.ts";

export function resolvePostgresConfig(config: PostgresRuntimeConfig, env?: Record<string, string | undefined>) {
	const connectionString = readEnv(config.connectionStringEnv, env);
	if (!connectionString) {
		// Name the variable, never its value
		throw new Error(`[runtime-config] ${config.connectionStringEnv} is not set; it must hold the Postgres connection string`);
	}
	return { connectionString, pool: config.pool, ssl: config.ssl };
}

export function createDialect(config: PostgresRuntimeConfig) {
	return createPostgresDialect(resolvePostgresConfig(config));
}
