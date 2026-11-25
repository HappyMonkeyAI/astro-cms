import {
	createPluginRuntimeTestHost,
	createPluginTestHost,
	type PluginRuntimeTestHost,
	type PluginTestHost,
} from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";
import {
	hasSlotConflict,
	isValidIsoDate,
	isValidTimeSlot,
	normaliseServices,
	type BookingRecord,
} from "../src/model.js";

let host: PluginTestHost | undefined;
let runtime: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	await runtime?.dispose();
	host = undefined;
	runtime = undefined;
});

describe("booking model helpers", () => {
	it("validates ISO calendar dates strictly", () => {
		expect(isValidIsoDate("2026-12-01")).toBe(true);
		expect(isValidIsoDate("2026-02-30")).toBe(false);
		expect(isValidIsoDate("2026-13-01")).toBe(false);
		expect(isValidIsoDate("12-01-2026")).toBe(false);
	});

	it("validates 24-hour HH:MM time slots", () => {
		expect(isValidTimeSlot("09:00")).toBe(true);
		expect(isValidTimeSlot("23:59")).toBe(true);
		expect(isValidTimeSlot("24:00")).toBe(false);
		expect(isValidTimeSlot("9:00")).toBe(false);
	});

	it("normalises service lists and falls back to defaults when empty", () => {
		expect(normaliseServices(" Coaching , design,coaching, ")).toEqual(["coaching", "design"]);
		expect(normaliseServices("   ")).toEqual(["consultation", "development", "design"]);
	});

	it("detects active slot conflicts while ignoring cancelled and excluded records", () => {
		const bookings: BookingRecord[] = [
			{
				id: "b1",
				service: "consultation",
				date: "2026-12-10",
				time: "10:00",
				customerName: "Ada",
				customerEmail: "ada@example.com",
				notes: null,
				status: "confirmed",
				createdAt: "2026-11-25T10:00:00.000Z",
				updatedAt: "2026-11-25T10:00:00.000Z",
			},
			{
				id: "b2",
				service: "design",
				date: "2026-12-10",
				time: "11:00",
				customerName: "Bob",
				customerEmail: "bob@example.com",
				notes: null,
				status: "cancelled",
				createdAt: "2026-11-25T10:00:00.000Z",
				updatedAt: "2026-11-25T10:00:00.000Z",
			},
		];

		expect(hasSlotConflict(bookings, { service: "consultation", date: "2026-12-10", time: "10:00" })).toBe(true);
		expect(hasSlotConflict(bookings, { service: "consultation", date: "2026-12-10", time: "10:00" }, "b1")).toBe(false);
		expect(hasSlotConflict(bookings, { service: "design", date: "2026-12-10", time: "11:00" })).toBe(false);
	});
});

describe("bookings sandboxed plugin routes", () => {
	it("creates bookings, blocks double bookings, and omits PII from public availability", async () => {
		host = await createPluginTestHost();

		const created = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-15",
			time: "10:00",
			customerName: "Grace Hopper",
			customerEmail: "grace@example.com",
			notes: "Architecture review",
		})) as { ok: boolean; booking: BookingRecord };

		expect(created.ok).toBe(true);
		expect(created.booking.status).toBe("pending");

		const conflict = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-15",
			time: "10:00",
			customerName: "Linus",
			customerEmail: "linus@example.com",
		})) as { ok: boolean; error: string };

		expect(conflict.ok).toBe(false);
		expect(conflict.error).toBe("SLOT_UNAVAILABLE");

		const availability = (await host.invokeRoute("availability", {
			date: "2026-12-15",
			service: "consultation",
		})) as {
			ok: boolean;
			bookedTimes: string[];
			bookedSlots: Array<Record<string, unknown>>;
		};

		expect(availability.ok).toBe(true);
		expect(availability.bookedTimes).toEqual(["10:00"]);
		expect(JSON.stringify(availability)).not.toContain("grace@example.com");
		expect(JSON.stringify(availability)).not.toContain("Grace Hopper");
		expect(availability.bookedSlots[0]).not.toHaveProperty("customerEmail");
		expect(availability.bookedSlots[0]).not.toHaveProperty("customerName");
	});

	it("rejects honeypot spam, invalid dates, and unknown services", async () => {
		host = await createPluginTestHost();

		const spam = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-15",
			time: "11:00",
			customerName: "Bot",
			customerEmail: "bot@example.com",
			website: "https://spam.example.com",
		})) as { ok: boolean; error: string };
		expect(spam).toMatchObject({ ok: false, error: "SPAM_REJECTED" });

		const badDate = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-02-30",
			time: "11:00",
			customerName: "Ada",
			customerEmail: "ada@example.com",
		})) as { ok: boolean; error: string };
		expect(badDate).toMatchObject({ ok: false, error: "INVALID_DATE" });

		const badService = (await host.invokeRoute("create", {
			service: "plumbing",
			date: "2026-12-15",
			time: "11:00",
			customerName: "Ada",
			customerEmail: "ada@example.com",
		})) as { ok: boolean; error: string };
		expect(badService).toMatchObject({ ok: false, error: "INVALID_SERVICE" });
	});

	it("filters list results, checks conflicts on update, and frees slots on cancel", async () => {
		host = await createPluginTestHost();

		const first = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-18",
			time: "09:00",
			customerName: "Alice",
			customerEmail: "alice@example.com",
		})) as { ok: boolean; booking: BookingRecord };

		const second = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-18",
			time: "14:00",
			customerName: "Bob",
			customerEmail: "bob@example.com",
		})) as { ok: boolean; booking: BookingRecord };

		const listed = (await host.invokeRoute("list", {
			date: "2026-12-18",
			status: "pending",
		})) as { ok: boolean; count: number; items: BookingRecord[] };
		expect(listed.ok).toBe(true);
		expect(listed.count).toBe(2);

		const rescheduleConflict = (await host.invokeRoute("update", {
			id: second.booking.id,
			time: "09:00",
		})) as { ok: boolean; error: string };
		expect(rescheduleConflict).toMatchObject({ ok: false, error: "SLOT_UNAVAILABLE" });

		const cancelled = (await host.invokeRoute("cancel", {
			id: first.booking.id,
		})) as { ok: boolean; booking: BookingRecord };
		expect(cancelled.ok).toBe(true);
		expect(cancelled.booking.status).toBe("cancelled");

		const rebooked = (await host.invokeRoute("create", {
			service: "consultation",
			date: "2026-12-18",
			time: "09:00",
			customerName: "Charlie",
			customerEmail: "charlie@example.com",
		})) as { ok: boolean; booking: BookingRecord };
		expect(rebooked.ok).toBe(true);
	});

	it("renders admin Block Kit dashboard, handles confirm/cancel actions, and updates services", async () => {
		host = await createPluginTestHost();

		const created = (await host.invokeRoute("create", {
			service: "design",
			date: "2026-12-20",
			time: "15:00",
			customerName: "Dana",
			customerEmail: "dana@example.com",
		})) as { ok: boolean; booking: BookingRecord };

		const loaded = (await host.invokeRoute("admin", {
			type: "page_load",
			page: "/bookings",
		})) as { blocks: Array<{ type: string; text?: string }> };
		expect(loaded.blocks.some((b) => b.type === "header" && b.text === "Bookings")).toBe(true);

		const confirmed = (await host.invokeRoute("admin", {
			type: "block_action",
			action_id: `confirm:${created.booking.id}`,
			value: created.booking.id,
		})) as { toast?: { type: string; message: string } };
		expect(confirmed.toast?.type).toBe("success");

		const savedServices = (await host.invokeRoute("admin", {
			type: "form_submit",
			form_id: "save_services",
			values: { services: "strategy, coaching" },
		})) as { toast?: { type: string; message: string } };
		expect(savedServices.toast?.type).toBe("success");

		const avail = (await host.invokeRoute("availability", {
			date: "2026-12-20",
		})) as { services: string[] };
		expect(avail.services).toEqual(["strategy", "coaching"]);
	});

	it("enforces permissions on private routes via the EmDash runtime host", async () => {
		runtime = await createPluginRuntimeTestHost();
		const editor = await runtime.fixtures.user({
			email: "editor@example.com",
			name: "Editor",
			role: "editor",
		});

		const anonList = await runtime.actions.routes.request("list", {});
		expect(anonList.status).toBe(401);

		const publicCreate = await runtime.actions.routes.request("create", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: {
				service: "consultation",
				date: "2026-12-22",
				time: "11:00",
				customerName: "Elena",
				customerEmail: "elena@example.com",
			},
		});
		expect(publicCreate.status, await publicCreate.clone().text()).toBe(200);

		const editorList = await runtime.actions.routes.request("list", {
			user: editor,
			headers: { "X-EmDash-Request": "1" },
		});
		expect(editorList.status, await editorList.clone().text()).toBe(200);
		expect(JSON.stringify(await editorList.json())).toContain("elena@example.com");
	});
});
