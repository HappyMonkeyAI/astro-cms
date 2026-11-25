import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { z } from "zod";
import {
	availabilityInput,
	cancelBookingInput,
	createBookingInput,
	hasSlotConflict,
	isValidIsoDate,
	isValidTimeSlot,
	listBookingsInput,
	normaliseServices,
	SERVICES_SETTING_KEY,
	updateBookingInput,
	type BookingRecord,
} from "./model.js";

interface Collection<T> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	query(options?: Record<string, unknown>): Promise<{ items: Array<{ id: string; data: T }> }>;
	count(where?: Record<string, unknown>): Promise<number>;
}

const bookingsStore = (ctx: PluginContext) => ctx.storage.bookings as unknown as Collection<BookingRecord>;

async function getConfiguredServices(ctx: PluginContext): Promise<string[]> {
	const saved = await ctx.settings.get<string | string[]>(SERVICES_SETTING_KEY);
	return normaliseServices(saved);
}

async function listBookingsOnDate(ctx: PluginContext, date: string): Promise<BookingRecord[]> {
	const result = await bookingsStore(ctx).query({
		where: { date },
		orderBy: { createdAt: "asc" },
		limit: 500,
	});
	return result.items.map((item) => item.data);
}

async function listAllBookings(ctx: PluginContext, limit = 200): Promise<BookingRecord[]> {
	const result = await bookingsStore(ctx).query({
		orderBy: { createdAt: "desc" },
		limit,
	});
	return result.items.map((item) => item.data);
}

function makeError(error: string, message: string) {
	return { ok: false as const, error, message };
}

const adminInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({
		type: z.literal("block_action"),
		action_id: z.string(),
		value: z.unknown().optional(),
	}),
	z.object({
		type: z.literal("form_submit"),
		form_id: z.string(),
		values: z.record(z.string(), z.unknown()),
	}),
]);

async function buildAdminBlocks(
	ctx: PluginContext,
	toast?: { type: "success" | "error"; message: string },
) {
	const [allBookings, services] = await Promise.all([
		listAllBookings(ctx, 200),
		getConfiguredServices(ctx),
	]);
	const sorted = [...allBookings].sort((a, b) =>
		`${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
	);
	const pendingCount = sorted.filter((b) => b.status === "pending").length;
	const confirmedCount = sorted.filter((b) => b.status === "confirmed").length;
	const cancelledCount = sorted.filter((b) => b.status === "cancelled").length;
	const active = sorted.filter((b) => b.status !== "cancelled");

	const blocks: Array<Record<string, unknown>> = [
		{ type: "header", text: "Bookings" },
		{
			type: "context",
			text: "Review upcoming appointments, confirm pending bookings, or configure bookable services.",
		},
		{
			type: "stats",
			items: [
				{ label: "Pending", value: String(pendingCount) },
				{ label: "Confirmed", value: String(confirmedCount) },
				{ label: "Cancelled", value: String(cancelledCount) },
			],
		},
		{
			type: "actions",
			elements: [{ type: "button", label: "Refresh", action_id: "refresh" }],
		},
		{
			type: "form",
			form_id: "save_services",
			submit_label: "Save services",
			fields: [
				{
					name: "services",
					label: "Available services (comma-separated)",
					type: "text",
					value: services.join(", "),
				},
			],
		},
	];

	if (active.length === 0) {
		blocks.push({ type: "banner", description: "No active bookings yet." });
	} else {
		for (const booking of active) {
			blocks.push({ type: "divider" });
			blocks.push({
				type: "section",
				text: `**${booking.date} ${booking.time}** — ${booking.service} (${booking.status})\n${booking.customerName} <${booking.customerEmail}>${booking.notes ? `\nNotes: ${booking.notes}` : ""}`,
			});
			blocks.push({
				type: "actions",
				elements: [
					...(booking.status === "pending"
						? [
								{
									type: "button",
									label: "Confirm",
									action_id: `confirm:${booking.id}`,
									value: booking.id,
									style: "primary",
								},
							]
						: []),
					{
						type: "button",
						label: "Cancel",
						action_id: `cancel:${booking.id}`,
						value: booking.id,
						style: "danger",
					},
				],
			});
		}
	}

	blocks.push({ type: "divider" });
	blocks.push({
		type: "table",
		columns: [
			{ key: "date", label: "Date" },
			{ key: "time", label: "Time" },
			{ key: "service", label: "Service" },
			{ key: "customerName", label: "Customer" },
			{ key: "customerEmail", label: "Email" },
			{ key: "status", label: "Status" },
		],
		rows: sorted.slice(0, 50).map((b) => ({
			id: b.id,
			date: b.date,
			time: b.time,
			service: b.service,
			customerName: b.customerName,
			customerEmail: b.customerEmail,
			status: b.status,
		})),
		empty_text: "No bookings recorded.",
	});

	return { blocks, ...(toast ? { toast } : {}) };
}

async function setBookingStatus(
	ctx: PluginContext,
	id: string,
	status: "confirmed" | "cancelled",
): Promise<{ ok: boolean; message: string }> {
	const existing = await bookingsStore(ctx).get(id);
	if (!existing) {
		return { ok: false, message: `Booking ${id} was not found.` };
	}
	await bookingsStore(ctx).put(id, {
		...existing,
		status,
		updatedAt: new Date().toISOString(),
	});
	return {
		ok: true,
		message:
			status === "confirmed"
				? `Confirmed booking for ${existing.date} at ${existing.time}.`
				: `Cancelled booking for ${existing.date} at ${existing.time}.`,
	};
}

async function handleAvailability(
	ctx: PluginContext,
	rawInput: unknown,
) {
	const parsed = availabilityInput.safeParse(rawInput);
	if (!parsed.success) {
		return makeError("INVALID_INPUT", "Invalid availability query.");
	}
	const { date, service } = parsed.data;
	if (!isValidIsoDate(date)) {
		return makeError("INVALID_DATE", "Date must be a valid YYYY-MM-DD calendar date.");
	}

	const services = await getConfiguredServices(ctx);
	const normalisedService = service?.toLowerCase();
	if (normalisedService && !services.includes(normalisedService)) {
		return makeError("INVALID_SERVICE", `Unknown service "${service}".`);
	}

	const onDate = await listBookingsOnDate(ctx, date);
	const bookedSlots = onDate
		.filter((b) => b.status !== "cancelled")
		.filter((b) => !normalisedService || b.service.toLowerCase() === normalisedService)
		.map((b) => ({
			service: b.service,
			time: b.time,
			status: b.status,
		}))
		.sort((a, b) => a.time.localeCompare(b.time));

	return {
		ok: true as const,
		date,
		services,
		bookedTimes: [...new Set(bookedSlots.map((s) => s.time))],
		bookedSlots,
	};
}

async function handleCreateBooking(
	ctx: PluginContext,
	rawInput: unknown,
) {
	const parsed = createBookingInput.safeParse(rawInput);
	if (!parsed.success) {
		return makeError("INVALID_INPUT", "Please check the required booking fields.");
	}
	const input = parsed.data;
	if (input.website && input.website.trim().length > 0) {
		return makeError("SPAM_REJECTED", "Submission rejected.");
	}
	if (!isValidIsoDate(input.date)) {
		return makeError("INVALID_DATE", "Date must be a valid YYYY-MM-DD calendar date.");
	}
	if (!isValidTimeSlot(input.time)) {
		return makeError("INVALID_TIME", "Time must be a valid HH:MM 24-hour slot.");
	}

	const services = await getConfiguredServices(ctx);
	const service = input.service.toLowerCase();
	if (!services.includes(service)) {
		return makeError("INVALID_SERVICE", `Service "${input.service}" is not available.`);
	}

	const existingOnDate = await listBookingsOnDate(ctx, input.date);
	if (hasSlotConflict(existingOnDate, { service, date: input.date, time: input.time })) {
		return makeError(
			"SLOT_UNAVAILABLE",
			`${service} on ${input.date} at ${input.time} is already booked.`,
		);
	}

	const now = new Date().toISOString();
	const record: BookingRecord = {
		id: crypto.randomUUID(),
		service,
		date: input.date,
		time: input.time,
		customerName: input.customerName,
		customerEmail: input.customerEmail,
		notes: input.notes && input.notes.length > 0 ? input.notes : null,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	};

	await bookingsStore(ctx).put(record.id, record);
	ctx.log.info("bookings.created", {
		id: record.id,
		service: record.service,
		date: record.date,
		time: record.time,
	});

	return {
		ok: true as const,
		booking: record,
	};
}

const plugin: SandboxedPlugin = {
	routes: {
		availability: {
			public: true,
			methods: ["GET"],
			input: availabilityInput,
			handler: (routeCtx, ctx) => handleAvailability(ctx, routeCtx.input),
		},

		mcpAvailability: {
			permission: "content:read",
			input: availabilityInput,
			handler: (routeCtx, ctx) => handleAvailability(ctx, routeCtx.input),
		},

		create: {
			public: true,
			methods: ["POST"],
			input: createBookingInput,
			handler: (routeCtx, ctx) => handleCreateBooking(ctx, routeCtx.input),
		},

		mcpCreate: {
			permission: "content:edit_any",
			methods: ["POST"],
			input: createBookingInput,
			handler: (routeCtx, ctx) => handleCreateBooking(ctx, routeCtx.input),
		},

		list: {
			permission: "content:read",
			input: listBookingsInput,
			handler: async (routeCtx, ctx) => {
				const parsed = listBookingsInput.safeParse(routeCtx.input ?? {});
				if (!parsed.success) {
					return makeError("INVALID_INPUT", "Invalid booking filter parameters.");
				}
				const filters = parsed.data;
				if (filters.date && !isValidIsoDate(filters.date)) {
					return makeError("INVALID_DATE", "Date filter must be a valid YYYY-MM-DD calendar date.");
				}

				const where: Record<string, unknown> = {};
				if (filters.status) where.status = filters.status;
				if (filters.date) where.date = filters.date;
				if (filters.service) where.service = filters.service.toLowerCase();

				const result = await bookingsStore(ctx).query({
					...(Object.keys(where).length > 0 ? { where } : {}),
					orderBy: { createdAt: "desc" },
					limit: filters.limit ?? 100,
				});

				const items = result.items.map((item) => item.data);
				return {
					ok: true as const,
					count: items.length,
					items,
				};
			},
		},

		update: {
			permission: "content:edit_any",
			methods: ["POST"],
			input: updateBookingInput,
			handler: async (routeCtx, ctx) => {
				const parsed = updateBookingInput.safeParse(routeCtx.input);
				if (!parsed.success) {
					return makeError("INVALID_INPUT", "Invalid booking update payload.");
				}
				const input = parsed.data;
				const existing = await bookingsStore(ctx).get(input.id);
				if (!existing) {
					return makeError("NOT_FOUND", `Booking "${input.id}" was not found.`);
				}

				const nextDate = input.date ?? existing.date;
				const nextTime = input.time ?? existing.time;
				const nextService = (input.service ?? existing.service).toLowerCase();
				const nextStatus = input.status ?? existing.status;

				if (!isValidIsoDate(nextDate)) {
					return makeError("INVALID_DATE", "Date must be a valid YYYY-MM-DD calendar date.");
				}
				if (!isValidTimeSlot(nextTime)) {
					return makeError("INVALID_TIME", "Time must be a valid HH:MM 24-hour slot.");
				}

				const services = await getConfiguredServices(ctx);
				if (!services.includes(nextService)) {
					return makeError("INVALID_SERVICE", `Service "${nextService}" is not available.`);
				}

				if (nextStatus !== "cancelled") {
					const onDate = await listBookingsOnDate(ctx, nextDate);
					if (
						hasSlotConflict(
							onDate,
							{ service: nextService, date: nextDate, time: nextTime },
							existing.id,
						)
					) {
						return makeError(
							"SLOT_UNAVAILABLE",
							`${nextService} on ${nextDate} at ${nextTime} is already booked.`,
						);
					}
				}

				const updated: BookingRecord = {
					...existing,
					service: nextService,
					date: nextDate,
					time: nextTime,
					status: nextStatus,
					notes: input.notes !== undefined ? (input.notes || null) : existing.notes,
					updatedAt: new Date().toISOString(),
				};

				await bookingsStore(ctx).put(updated.id, updated);
				return { ok: true as const, booking: updated };
			},
		},

		cancel: {
			permission: "content:edit_any",
			methods: ["POST"],
			input: cancelBookingInput,
			handler: async (routeCtx, ctx) => {
				const parsed = cancelBookingInput.safeParse(routeCtx.input);
				if (!parsed.success) {
					return makeError("INVALID_INPUT", "Booking id is required.");
				}
				const existing = await bookingsStore(ctx).get(parsed.data.id);
				if (!existing) {
					return makeError("NOT_FOUND", `Booking "${parsed.data.id}" was not found.`);
				}

				const updated: BookingRecord = {
					...existing,
					status: "cancelled",
					updatedAt: new Date().toISOString(),
				};
				await bookingsStore(ctx).put(updated.id, updated);
				return { ok: true as const, booking: updated };
			},
		},

		admin: {
			permission: "content:read",
			handler: async (routeCtx, ctx) => {
				const parsed = adminInput.safeParse(routeCtx.input);
				if (!parsed.success) return buildAdminBlocks(ctx);
				const interaction = parsed.data;

				if (interaction.type === "form_submit" && interaction.form_id === "save_services") {
					const rawServices = interaction.values.services;
					const normalised = normaliseServices(
						typeof rawServices === "string" || Array.isArray(rawServices)
							? (rawServices as string | string[])
							: null,
					);
					await ctx.settings.set(SERVICES_SETTING_KEY, normalised);
					return buildAdminBlocks(ctx, {
						type: "success",
						message: `Saved services: ${normalised.join(", ")}`,
					});
				}

				if (interaction.type === "block_action") {
					if (interaction.action_id === "refresh") {
						return buildAdminBlocks(ctx);
					}
					if (
						interaction.action_id.startsWith("confirm:") ||
						interaction.action_id === "confirm"
					) {
						const id = interaction.action_id.startsWith("confirm:")
							? interaction.action_id.slice("confirm:".length)
							: typeof interaction.value === "string"
								? interaction.value
								: "";
						const result = await setBookingStatus(ctx, id, "confirmed");
						return buildAdminBlocks(ctx, {
							type: result.ok ? "success" : "error",
							message: result.message,
						});
					}
					if (
						interaction.action_id.startsWith("cancel:") ||
						interaction.action_id === "cancel"
					) {
						const id = interaction.action_id.startsWith("cancel:")
							? interaction.action_id.slice("cancel:".length)
							: typeof interaction.value === "string"
								? interaction.value
								: "";
						const result = await setBookingStatus(ctx, id, "cancelled");
						return buildAdminBlocks(ctx, {
							type: result.ok ? "success" : "error",
							message: result.message,
						});
					}
				}

				return buildAdminBlocks(ctx);
			},
		},
	},

	mcp: {
		tools: {
			checkAvailability: {
				description: "Check booked appointment slots for a given date (and optional service).",
				route: "mcpAvailability",
				input: availabilityInput,
				destructive: false,
			},
			createBooking: {
				description: "Create a new booking if the requested service, date, and time slot is available.",
				route: "mcpCreate",
				input: createBookingInput,
				destructive: false,
			},
			listBookings: {
				description: "List bookings filtered by status, date, service, or limit.",
				route: "list",
				input: listBookingsInput,
				destructive: false,
			},
			updateBooking: {
				description: "Update a booking's status, date, time, service, or notes.",
				route: "update",
				input: updateBookingInput,
				destructive: false,
			},
			cancelBooking: {
				description: "Cancel an existing booking so its time slot becomes available again.",
				route: "cancel",
				input: cancelBookingInput,
				destructive: true,
			},
		},
	},
};

export default plugin;
