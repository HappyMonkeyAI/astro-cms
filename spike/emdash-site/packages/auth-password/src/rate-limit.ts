/**
 * Fixed-window failure counter, in process memory.
 *
 * Per-instance only: a multi-instance deployment needs a shared store
 * (Postgres or Redis) before relying on this for brute-force protection.
 */

export interface RateLimiter {
	isBlocked(key: string): boolean;
	recordFailure(key: string): void;
	reset(key: string): void;
}

const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(options: {
	maxAttempts: number;
	windowMs: number;
	now?: () => number;
}): RateLimiter {
	const now = options.now ?? Date.now;
	const failures = new Map<string, { count: number; resetAt: number }>();

	const current = (key: string) => {
		const entry = failures.get(key);
		if (entry && entry.resetAt <= now()) {
			failures.delete(key);
			return undefined;
		}
		return entry;
	};

	const prune = () => {
		const t = now();
		for (const [key, entry] of failures) if (entry.resetAt <= t) failures.delete(key);
	};

	return {
		isBlocked: (key) => (current(key)?.count ?? 0) >= options.maxAttempts,
		recordFailure(key) {
			const entry = current(key);
			if (entry) {
				entry.count += 1;
				return;
			}
			if (failures.size >= MAX_TRACKED_KEYS) prune();
			failures.set(key, { count: 1, resetAt: now() + options.windowMs });
		},
		reset: (key) => void failures.delete(key),
	};
}
