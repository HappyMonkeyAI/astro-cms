/**
 * SMTP email provider for EmDash on Node.
 *
 * Credentials are NOT passed as options: EmDash serialises plugin options into the
 * build output. The transport reads `SMTP_URL` (e.g. smtps://user:pass@smtp.example.com:465)
 * from the environment at send time instead.
 *
 * @example
 * ```js
 * emdash({ plugins: [smtpEmail({ from: { email: "cms@example.com", name: "Example CMS" } })] });
 * ```
 */

import type { PluginDescriptor } from "emdash";

export interface SmtpEmailConfig {
	from: string | { email: string; name?: string };
	replyTo?: string;
	/** Environment variable holding the SMTP connection URL. @default "SMTP_URL" */
	urlEnv?: string;
}

export function assertValidConfig(config: SmtpEmailConfig): void {
	const email = typeof config.from === "string" ? config.from : config.from?.email;
	if (!email?.includes("@")) throw new Error('[email-smtp] config.from must be an email address, e.g. "cms@example.com"');
}

export function smtpEmail(config: SmtpEmailConfig): PluginDescriptor<SmtpEmailConfig> {
	assertValidConfig(config);
	return {
		id: "email-smtp",
		version: "0.1.0",
		entrypoint: "@astro-cms/email-smtp/plugin",
		format: "native",
		options: config,
		capabilities: ["hooks.email-transport:register"],
	};
}
