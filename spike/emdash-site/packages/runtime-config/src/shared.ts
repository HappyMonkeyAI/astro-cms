const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PostgresRuntimeConfig {
	connectionStringEnv: string;
	pool?: { min?: number; max?: number; connectionTimeoutMillis?: number; idleTimeoutMillis?: number };
	ssl?: boolean | { rejectUnauthorized?: boolean };
}

export interface LocalRuntimeConfig {
	directoryEnv: string;
	defaultDirectory: string;
	baseUrl: string;
}

export function assertEnvName(name: string): string {
	if (!ENV_NAME_PATTERN.test(name)) throw new Error(`[runtime-config] "${name}" is not a valid environment variable name`);
	return name;
}

/** Read an environment variable at call time. Never use import.meta.env here: Vite inlines it at build. */
export function readEnv(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
	const value = env[name]?.trim();
	return value ? value : undefined;
}
