import type { PluginContext, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";
import type { EmailDeliverEvent } from "emdash/plugin";
import type { Transporter } from "nodemailer";

import { assertValidConfig, type SmtpEmailConfig } from "./index.ts";

let transport: { url: string; transporter: Transporter } | undefined;

async function getTransport(url: string): Promise<Transporter> {
	// Reuse the pooled connection unless the URL changed (e.g. a rotated password)
	if (transport?.url !== url) {
		const nodemailer = await import("nodemailer");
		transport?.transporter.close();
		transport = { url, transporter: nodemailer.createTransport(url) };
	}
	return transport.transporter;
}

export function createSmtpDeliver(config: SmtpEmailConfig) {
	const urlEnv = config.urlEnv ?? "SMTP_URL";
	const from = typeof config.from === "string" ? { address: config.from, name: "" } : { address: config.from.email, name: config.from.name ?? "" };

	return async (event: EmailDeliverEvent, ctx: PluginContext): Promise<void> => {
		const url = process.env[urlEnv];
		if (!url) throw new Error(`[email-smtp] ${urlEnv} is not set; cannot deliver email`);

		const { message } = event;
		const transporter = await getTransport(url);
		const info = await transporter.sendMail({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			...(message.html ? { html: message.html } : {}),
			...(message.cc?.length ? { cc: message.cc } : {}),
			...((message.replyTo ?? config.replyTo) ? { replyTo: message.replyTo ?? config.replyTo } : {}),
		});
		// Log the recipient and message id only, never the body (it may contain sign-in links)
		ctx.log.info("email delivered via SMTP", { to: message.to, messageId: info.messageId });
	};
}

export function createPlugin(config: SmtpEmailConfig): ResolvedPlugin {
	assertValidConfig(config);
	return definePlugin({
		id: "email-smtp",
		version: "0.1.0",
		capabilities: ["hooks.email-transport:register"],
		hooks: {
			"email:deliver": { exclusive: true, handler: createSmtpDeliver(config) },
		},
	});
}

export default createPlugin;
