/**
 * Admin UI for the password provider: login button/form and setup wizard step.
 * Imported at build time via EmDash's virtual:emdash/auth-providers module.
 */

import { Button, Input } from "@cloudflare/kumo";
import * as React from "react";

async function postJson<T = unknown>(url: string, body: unknown): Promise<T | undefined> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const data: { error?: { message?: string } } = await response.json().catch(() => ({}));
		throw new Error(data?.error?.message || "Request failed");
	}
	const json: { data?: T } = await response.json().catch(() => ({}));
	return json.data;
}

function KeyIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
			<circle cx="7.5" cy="15.5" r="4.5" />
			<path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" />
		</svg>
	);
}

function ErrorBox({ message }: { message: string | null }) {
	if (!message) return null;
	return <div className="rounded-lg bg-kumo-danger/10 p-3 text-sm text-kumo-danger">{message}</div>;
}

/**
 * On the login page the host wraps this button and opens LoginForm on click.
 * On the invite page the host passes `inviteToken` and adds no click handling,
 * so the button opens the invite form itself.
 */
export function LoginButton({ inviteToken }: { inviteToken?: string }) {
	const [open, setOpen] = React.useState(false);
	if (inviteToken && open) return <InviteForm token={inviteToken} />;
	return (
		<Button
			type="button"
			variant="outline"
			className="w-full justify-center"
			onClick={inviteToken ? () => setOpen(true) : undefined}
		>
			<KeyIcon className="h-5 w-5" />
			<span>{inviteToken ? "Use a password instead" : "Password"}</span>
		</Button>
	);
}

function InviteForm({ token }: { token: string }) {
	const [name, setName] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [confirm, setConfirm] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirm) {
			setError("Passwords do not match");
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			await postJson("/_emdash/api/auth/password/invite-complete", { token, name, password });
			window.location.href = "/_emdash/admin";
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to accept invite");
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3 text-left">
			<Input label="Your name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={isLoading} />
			<Input label="Choose a password (12+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={isLoading} />
			<Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || !password || !confirm}>
				{isLoading ? "Creating account..." : "Create account"}
			</Button>
		</form>
	);
}

/** Reset-request step: emails a link; the response never says whether the address has an account. */
function ForgotForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
	const [email, setEmail] = React.useState(initialEmail);
	const [isLoading, setIsLoading] = React.useState(false);
	const [sent, setSent] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			await postJson("/_emdash/api/auth/password/reset-request", { email });
			setSent(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed");
		}
		setIsLoading(false);
	};

	if (sent) {
		return (
			<div className="space-y-3 text-center">
				<p className="text-sm">If an account exists for {email}, we have emailed a link to choose a new password. It works once and expires in 30 minutes.</p>
				<Button type="button" variant="outline" className="w-full" onClick={onBack}>
					Back to sign in
				</Button>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<p className="text-xs text-kumo-subtle text-center">Enter your email and we will send you a link to choose a new password.</p>
			<Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || !email}>
				{isLoading ? "Sending..." : "Email me a reset link"}
			</Button>
			<button type="button" className="w-full text-center text-sm text-kumo-subtle underline" onClick={onBack}>
				Back to sign in
			</button>
		</form>
	);
}

/** Email 2FA step: shown after a correct password when the account has 2FA on. */
function CodeForm({ challenge, onBack }: { challenge: string; onBack: () => void }) {
	const [code, setCode] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			await postJson("/_emdash/api/auth/password/login-verify", { challenge, code });
			window.location.href = "/_emdash/admin";
		} catch (err) {
			setError(err instanceof Error ? err.message : "Verification failed");
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<p className="text-xs text-kumo-subtle text-center">We emailed you a 6-digit code. It expires in 10 minutes.</p>
			<Input label="Sign-in code" type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={7} disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || code.replace(/\s/g, "").length !== 6}>
				{isLoading ? "Verifying..." : "Verify and sign in"}
			</Button>
			<button type="button" className="w-full text-center text-sm text-kumo-subtle underline" onClick={onBack}>
				Start over
			</button>
		</form>
	);
}

export function LoginForm() {
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [step, setStep] = React.useState<"password" | "forgot" | "code">("password");
	const [challenge, setChallenge] = React.useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			const data = await postJson<{ twoFactorRequired?: boolean; challenge?: string }>(
				"/_emdash/api/auth/password/login",
				{ email, password },
			);
			if (data?.twoFactorRequired && data.challenge) {
				setChallenge(data.challenge);
				setPassword("");
				setStep("code");
				setIsLoading(false);
				return;
			}
			window.location.href = "/_emdash/admin";
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign-in failed");
			setIsLoading(false);
		}
	};

	if (step === "forgot") return <ForgotForm initialEmail={email} onBack={() => setStep("password")} />;
	if (step === "code") return <CodeForm challenge={challenge} onBack={() => setStep("password")} />;

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" disabled={isLoading} />
			<Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || !email || !password}>
				{isLoading ? "Signing in..." : "Sign in"}
			</Button>
			<button type="button" className="w-full text-center text-sm text-kumo-subtle underline" onClick={() => setStep("forgot")}>
				Forgot password?
			</button>
		</form>
	);
}

export function loginHelp() {
	return "Sign in with your email address and password.";
}

export function SetupStep({ onComplete }: { onComplete: () => void }) {
	const [email, setEmail] = React.useState("");
	const [name, setName] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [confirm, setConfirm] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirm) {
			setError("Passwords do not match");
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			await postJson("/_emdash/api/setup/password-admin", { email, name, password });
			onComplete();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create admin");
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<p className="text-xs text-kumo-subtle text-center">
				Create the admin account with a password. You can add a passkey later.
			</p>
			<Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" disabled={isLoading} />
			<Input label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={isLoading} />
			<Input label="Password (12+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={isLoading} />
			<Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || !email || !password || !confirm}>
				{isLoading ? "Creating account..." : "Create admin account"}
			</Button>
		</form>
	);
}
