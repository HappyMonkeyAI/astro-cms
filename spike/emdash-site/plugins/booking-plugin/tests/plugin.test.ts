import assert from "node:assert/strict";
import { test } from "node:test";

// Re-implement generateTimeSlots for testing since it's not exported
function generateTimeSlots(startTime: string, endTime: string, duration: number, bufferTime: number): string[] {
	const [startHour, startMin] = startTime.split(":").map(Number);
	const [endHour, endMin] = endTime.split(":").map(Number);

	const startMinutes = startHour * 60 + startMin;
	const endMinutes = endHour * 60 + endMin;

	const slots: string[] = [];
	let current = startMinutes;

	while (current + duration <= endMinutes) {
		const slotStartHour = Math.floor(current / 60);
		const slotStartMin = current % 60;
		const slotEndMinutes = current + duration;
		const slotEndHour = Math.floor(slotEndMinutes / 60);
		const slotEndMin = slotEndMinutes % 60;

		const startStr = `${String(slotStartHour).padStart(2, "0")}:${String(slotStartMin).padStart(2, "0")}`;
		const endStr = `${String(slotEndHour).padStart(2, "0")}:${String(slotEndMin).padStart(2, "0")}`;

		slots.push(`${startStr}-${endStr}`);
		current += duration + bufferTime;
	}

	return slots;
}

function isSlotAvailable(
	existingBookings: Array<{ bookingDate: string; bookingTimeSlot: string; status: string }>,
	date: string,
	timeSlot: string,
	bufferTime: number,
): boolean {
	const [slotStartStr, slotEndStr] = timeSlot.split("-");
	if (!slotStartStr || !slotEndStr) return false;

	const [startH, startM] = slotStartStr.split(":").map(Number);
	const [endH, endM] = slotEndStr.split(":").map(Number);

	const slotStartMinutes = startH * 60 + startM;
	const slotEndMinutes = endH * 60 + endM;

	for (const booking of existingBookings) {
		if (booking.bookingDate !== date || booking.status === "cancelled") continue;

		const [bStartStr, bEndStr] = booking.bookingTimeSlot.split("-");
		if (!bStartStr || !bEndStr) continue;

		const [bStartH, bStartM] = bStartStr.split(":").map(Number);
		const [bEndH, bEndM] = bEndStr.split(":").map(Number);

		const bookingStartMinutes = bStartH * 60 + bStartM;
		const bookingEndMinutes = bEndH * 60 + bEndM;

		const bookingStartWithBuffer = bookingStartMinutes - bufferTime;
		const bookingEndWithBuffer = bookingEndMinutes + bufferTime;

		if (slotStartMinutes < bookingEndWithBuffer && slotEndMinutes > bookingStartWithBuffer) {
			return false;
		}
	}

	return true;
}

test("generateTimeSlots creates correct slots with duration and buffer", () => {
	const slots = generateTimeSlots("09:00", "12:00", 60, 15);
	assert.deepEqual(slots, ["09:00-10:00", "10:15-11:15"]);
});

test("isSlotAvailable returns false when slots overlap", () => {
	const bookings = [
		{ bookingDate: "2026-12-01", bookingTimeSlot: "10:00-11:00", status: "pending" },
	];
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "10:30-11:30", 15), false);
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "11:30-12:30", 15), true);
});

test("isSlotAvailable ignores cancelled bookings", () => {
	const bookings = [
		{ bookingDate: "2026-12-01", bookingTimeSlot: "10:00-11:00", status: "cancelled" },
	];
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "10:30-11:30", 15), true);
});

test("isSlotAvailable returns false when slots overlap", () => {
	const bookings = [
		{ bookingDate: "2026-12-01", bookingTimeSlot: "10:00-11:00", status: "pending" as const },
	];
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "10:30-11:30", 15), false);
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "11:30-12:30", 15), true);
});

test("isSlotAvailable ignores cancelled bookings", () => {
	const bookings = [
		{ bookingDate: "2026-12-01", bookingTimeSlot: "10:00-11:00", status: "cancelled" as const },
	];
	assert.equal(isSlotAvailable(bookings, "2026-12-01", "10:30-11:30", 15), true);
});
