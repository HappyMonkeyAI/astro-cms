/** Plain builders for the reset and 2FA emails (no I/O). */

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export const escapeHtml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildResetEmail(input: { to: string; siteName: string; url: string }): EmailMessage {
	const site = escapeHtml(input.siteName);
	return {
		to: input.to,
		subject: `Reset your password for ${input.siteName}`,
		text: `Someone asked to reset the password for your ${input.siteName} account.\n\nChoose a new password here (the link works once and expires in 30 minutes):\n${input.url}\n\nIf this wasn't you, you can ignore this email. Your password has not changed.`,
		html: `<p>Someone asked to reset the password for your ${site} account.</p><p><a href="${escapeHtml(input.url)}">Choose a new password</a></p><p>The link works once and expires in 30 minutes. If this wasn't you, you can ignore this email. Your password has not changed.</p>`,
	};
}

export function buildCodeEmail(input: { to: string; siteName: string; code: string }): EmailMessage {
	const site = escapeHtml(input.siteName);
	return {
		to: input.to,
		subject: `Your ${input.siteName} sign-in code: ${input.code}`,
		text: `Your sign-in code for ${input.siteName} is ${input.code}\n\nIt expires in 10 minutes. If you didn't just try to sign in, change your password.`,
		html: `<p>Your sign-in code for ${site} is:</p><p style="font-size:24px;letter-spacing:4px"><strong>${escapeHtml(input.code)}</strong></p><p>It expires in 10 minutes. If you didn't just try to sign in, change your password.</p>`,
	};
}

export function resetPageHtml(input: { token: string | null; message?: string; done?: boolean }): string {
	const body = input.done
		? `<p>Your password has been changed.</p><p><a href="/_emdash/admin/login">Sign in</a></p>`
		: input.token
			? `${input.message ? `<p class="err">${escapeHtml(input.message)}</p>` : ""}<form method="post" action="/_emdash/api/auth/password/reset"><input type="hidden" name="token" value="${escapeHtml(input.token)}"><label>New password (12+ characters)<input type="password" name="password" autocomplete="new-password" required minlength="12"></label><label>Confirm password<input type="password" name="confirm" autocomplete="new-password" required minlength="12"></label><button type="submit">Set new password</button></form>`
			: `<p class="err">${escapeHtml(input.message ?? "This reset link is invalid or has expired.")}</p><p><a href="/_emdash/admin/login">Back to sign in</a></p>`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reset password</title><style>body{font-family:system-ui,sans-serif;background:#f6f6f6;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;padding:2rem;border-radius:12px;max-width:380px;width:100%;box-shadow:0 1px 8px #0002}label{display:block;margin:.75rem 0;font-size:.9rem}input{display:block;width:100%;box-sizing:border-box;padding:.55rem;margin-top:.25rem;border:1px solid #bbb;border-radius:6px}button{width:100%;padding:.65rem;border:0;border-radius:6px;background:#111;color:#fff;font-size:1rem;cursor:pointer}.err{color:#b00020}</style></head><body><main><h1 style="font-size:1.3rem">Reset your password</h1>${body}</main></body></html>`;
}
