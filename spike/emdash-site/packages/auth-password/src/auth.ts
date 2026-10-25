/**
 * Email + password authentication provider for EmDash.
 *
 * Additive to the built-in passkey flow: the setup wizard and login page show
 * "Password" alongside passkeys and any other configured providers.
 *
 * @example
 * ```ts
 * import { password } from "@astro-cms/auth-password";
 *
 * emdash({ authProviders: [password()] });
 * ```
 */

import type { AuthProviderDescriptor } from "emdash";

import { PROVIDER_ID, STORAGE } from "./shared.ts";

export interface PasswordAuthConfig {
	/** Minimum password length. @default 12 */
	minLength?: number;
	/** Failed attempts allowed per email + IP before lockout. @default 5 */
	maxAttempts?: number;
	/** Lockout window in minutes. @default 15 */
	lockoutMinutes?: number;
}

export function password(config: PasswordAuthConfig = {}): AuthProviderDescriptor {
	return {
		id: PROVIDER_ID,
		label: "Password",
		config,
		adminEntry: "@astro-cms/auth-password/admin",
		routes: [
			{
				pattern: "/_emdash/api/auth/password/login",
				entrypoint: "@astro-cms/auth-password/routes/login.ts",
			},
			{
				pattern: "/_emdash/api/setup/password-admin",
				entrypoint: "@astro-cms/auth-password/routes/setup-admin.ts",
			},
		],
		publicRoutes: ["/_emdash/api/auth/password/"],
		storage: STORAGE,
	};
}
