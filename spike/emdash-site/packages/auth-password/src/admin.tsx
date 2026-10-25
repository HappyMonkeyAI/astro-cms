/**
 * Admin UI for the password provider: login button/form and setup wizard step.
 * Imported at build time via EmDash's virtual:emdash/auth-providers module.
 */

import { Button, Input } from "@cloudflare/kumo";
import * as React from "react";

async function postJson(url: string, body: unknown): Promise<void> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const data: { error?: { message?: string } } = await response.json().catch(() => ({}));
		throw new Error(data?.error?.message || "Request failed");
	}
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

export function LoginButton() {
	return (
		<Button type="button" variant="outline" className="w-full justify-center">
			<KeyIcon className="h-5 w-5" />
			<span>Password</span>
		</Button>
	);
}

export function LoginForm() {
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			await postJson("/_emdash/api/auth/password/login", { email, password });
			window.location.href = "/_emdash/admin";
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign-in failed");
			setIsLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" disabled={isLoading} />
			<Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={isLoading} />
			<ErrorBox message={error} />
			<Button type="submit" className="w-full" disabled={isLoading || !email || !password}>
				{isLoading ? "Signing in..." : "Sign in"}
			</Button>
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
