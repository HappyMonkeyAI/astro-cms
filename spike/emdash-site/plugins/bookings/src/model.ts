import { z } from "zod";

export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface BookingRecord {
	id: string;
	service: string;
	date: string;
	time: string;
	customerName: string;
	customerEmail: string;
	notes: string | null;
	status: BookingStatus;
	createdAt: string;
	updatedAt: string;
}

export const DEFAULT_SERVICES = ["consultation", "development", "design"] as const;
export const SERVICES_SETTING_KEY = "services";

export function isValidIsoDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const [yearStr, monthStr, dayStr] = date.split("-");
	const year = Number(yearStr);
	const month = Number(monthStr);
	const day = Number(dayStr);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

export function isValidTimeSlot(time: string): boolean {
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function normaliseServices(input: string | readonly string[] | null | undefined): string[] {
	const raw =
		typeof input === "string"
			? input.split(",")
			: Array.isArray(input)
				? input
				: [];
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const value = item.trim().toLowerCase();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		cleaned.push(value);
	}
	return cleaned.length > 0 ? cleaned : [...DEFAULT_SERVICES];
}

export function hasSlotConflict(
	bookings: readonly BookingRecord[],
	slot: { service: string; date: string; time: string },
	excludeId?: string,
): boolean {
	const targetService = slot.service.trim().toLowerCase();
	return bookings.some(
		(booking) =>
			booking.status !== "cancelled" &&
			booking.id !== excludeId &&
			booking.service.trim().toLowerCase() === targetService &&
			booking.date === slot.date &&
			booking.time === slot.time,
	);
}

export const availabilityInput = z.object({
	date: z.string().trim(),
	service: z.string().trim().optional(),
});

export const createBookingInput = z.object({
	service: z.string().trim().min(1),
	date: z.string().trim(),
	time: z.string().trim(),
	customerName: z.string().trim().min(1).max(120),
	customerEmail: z.string().trim().email().max(254),
	notes: z.string().trim().max(1000).optional(),
	website: z.string().optional(),
});

export const listBookingsInput = z.object({
	status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
	date: z.string().trim().optional(),
	service: z.string().trim().optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const updateBookingInput = z.object({
	id: z.string().trim().min(1),
	status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
	date: z.string().trim().optional(),
	time: z.string().trim().optional(),
	service: z.string().trim().min(1).optional(),
	notes: z.string().trim().max(1000).optional(),
});

export const cancelBookingInput = z.object({
	id: z.string().trim().min(1),
});
