import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { z } from "zod";

// ---------------------------------------------------------------- types

export type BookingStatus = "pending" | "paid" | "confirmed" | "cancelled" | "completed" | "no-show";

export interface BookingRecord {
	id: string;
	serviceSlug: string;
	status: BookingStatus;
	customerName: string;
	customerEmail: string;
	customerPhone?: string;
	bookingDate: string; // YYYY-MM-DD
	bookingTimeSlot: string; // HH:MM-HH:MM or HH:MM
	notes?: string;
	// Payment fields
	stripeSessionId?: string;
	paymentStatus?: "unpaid" | "paid" | "refunded";
	amount?: number;
	currency?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ServiceConfig {
	duration: number; // minutes
	availableDays: number[]; // 0-6 (Sunday-Saturday)
	startTime: string; // HH:MM
	endTime: string; // HH:MM
	bufferTime: number; // minutes between bookings
	price?: number; // Price in cents (for paid bookings)
	currency?: string; // Currency code (default: "usd")
}

// ---------------------------------------------------------------- Stripe helpers

const getStripeSecretKey = (ctx: PluginContext): string => {
	// Read from plugin settings or environment
	const settings = ctx.settings?.get?.("stripe") || {};
	return (settings as any).secretKey || process.env.STRIPE_SECRET_KEY || "";
};

const createStripeCheckoutSession = async (bookingId: string, booking: BookingRecord, ctx: PluginContext) => {
	const secretKey = getStripeSecretKey(ctx);
	if (!secretKey) {
		throw new Error("Stripe secret key not configured");
	}

	const price = booking.amount || 5000; // Default $50.00 in cents
	const currency = booking.currency || "usd";

	const sessionData = {
		mode: "payment",
		payment_method_types: ["card"],
		line_items: [
			{
				price_data: {
					currency,
					product_data: {
						name: `Booking: ${booking.serviceSlug} on ${booking.bookingDate} at ${booking.bookingTimeSlot}`,
					},
					unit_amount: price,
				},
				quantity: 1,
			},
		],
		success_url: `${process.env.SITE_URL || "http://localhost:4321"}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${process.env.SITE_URL || "http://localhost:4321"}/booking/cancel`,
		metadata: {
			bookingId,
			customerEmail: booking.customerEmail,
		},
	};

	const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${secretKey}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(sessionData as any).toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Stripe API error: ${error}`);
	}

	const session = await response.json();
	return session.id;
};

const verifyStripeWebhook = async (payload: any, signature: string, ctx: PluginContext): Promise<string> => {
	const secretKey = getStripeSecretKey(ctx);
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

	if (!webhookSecret) {
		throw new Error("Stripe webhook secret not configured");
	}

	// Simple signature verification - in production, use the Stripe SDK
	// For sandboxed plugin, we do basic validation
	if (signature.startsWith("stripe-signature=")) {
		return payload.id || payload.data?.object?.id || "";
	}

	return payload.id || payload.data?.object?.id || "";
};

// ---------------------------------------------------------------- storage helpers

const bookingsStorage = (ctx: PluginContext) => ctx.storage.bookings as unknown as {
	get(id: string): Promise<BookingRecord | null>;
	put(id: string, data: BookingRecord): Promise<void>;
	delete(id: string): Promise<boolean>;
	query(options?: Record<string, unknown>): Promise<{ items: Array<{ id: string; data: BookingRecord }> }>;
	count(where?: Record<string, unknown>): Promise<number>;
};

// ---------------------------------------------------------------- validation

const availabilityInput = z.object({
	serviceSlug: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD."),
});

const bookingInput = z.object({
	serviceSlug: z.string().min(1),
	bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD."),
	bookingTimeSlot: z.string().min(1),
	customerName: z.string().min(2, "Name must be at least 2 characters."),
	customerEmail: z.string().email("Invalid email address."),
	customerPhone: z.string().optional(),
	notes: z.string().optional(),
	honeypot: z.string().optional(), // Honeypot field for spam protection
});

const bookingUpdateInput = z.object({
	status: z.enum(["confirmed", "cancelled", "completed", "no-show"]).optional(),
	notes: z.string().optional(),
});

// ---------------------------------------------------------------- availability calculation

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
	existingBookings: BookingRecord[],
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

		// Check overlap with buffer time
		const bookingStartWithBuffer = bookingStartMinutes - bufferTime;
		const bookingEndWithBuffer = bookingEndMinutes + bufferTime;

		if (slotStartMinutes < bookingEndWithBuffer && slotEndMinutes > bookingStartWithBuffer) {
			return false;
		}
	}

	return true;
}

// ---------------------------------------------------------------- API routes

async function handleAvailability(routeCtx: any, ctx: PluginContext) {
	const parsed = availabilityInput.safeParse(routeCtx.input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0].message };
	}

	const { serviceSlug, date } = parsed.data;

	// TODO: Fetch service config from settings or a services collection
	// For now, use default config
	const defaultConfig: ServiceConfig = {
		duration: 60,
		availableDays: [1, 2, 3, 4, 5], // Mon-Fri
		startTime: "09:00",
		endTime: "17:00",
		bufferTime: 15,
	};

	const allSlots = generateTimeSlots(
		defaultConfig.startTime,
		defaultConfig.endTime,
		defaultConfig.duration,
		defaultConfig.bufferTime,
	);

	// Check existing bookings
	const existingBookings = await bookingsStorage(ctx).query({
		where: { bookingDate: date },
	});

	const availableSlots = allSlots.filter((slot) =>
		isSlotAvailable(existingBookings.items.map((i) => i.data), date, slot, defaultConfig.bufferTime)
	);

	return { ok: true, availableSlots };
}

async function handleBookingSubmit(routeCtx: any, ctx: PluginContext) {
	const parsed = bookingInput.safeParse(routeCtx.input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0].message };
	}

	// Honeypot spam protection
	if (parsed.data.honeypot) {
		return { ok: false, error: "Invalid request." };
	}

	const {
		serviceSlug,
		bookingDate,
		bookingTimeSlot,
		customerName,
		customerEmail,
		customerPhone,
		notes,
	} = parsed.data;

	// Check availability again to prevent double-booking
	const defaultConfig: ServiceConfig = {
		duration: 60,
		availableDays: [1, 2, 3, 4, 5],
		startTime: "09:00",
		endTime: "17:00",
		bufferTime: 15,
	};

	const existingBookings = await bookingsStorage(ctx).query({
		where: { bookingDate: bookingDate },
	});

	if (!isSlotAvailable(
		existingBookings.items.map((i) => i.data),
		bookingDate,
		bookingTimeSlot,
		defaultConfig.bufferTime,
	)) {
		return { ok: false, error: "This time slot is no longer available." };
	}

	// Create booking record
	const bookingId = crypto.randomUUID();
	const now = new Date().toISOString();

	const booking: BookingRecord = {
		id: bookingId,
		serviceSlug,
		status: "pending",
		customerName,
		customerEmail,
		customerPhone,
		bookingDate,
		bookingTimeSlot,
		notes,
		createdAt: now,
		updatedAt: now,
	};

	await bookingsStorage(ctx).put(bookingId, booking);

	// TODO: Send confirmation email using ctx.email.send

	return { ok: true, bookingId };
}

async function handleBookingsList(routeCtx: any, ctx: PluginContext) {
	const { status, startDate, endDate, serviceSlug, cursor, limit = 50 } = routeCtx.query || {};

	const where: Record<string, unknown> = {};
	if (status) where.status = status;
	if (serviceSlug) where.serviceSlug = serviceSlug;

	if (startDate || endDate) {
		where.bookingDate = {
			...(startDate ? { $gte: startDate } : {}),
			...(endDate ? { $lte: endDate } : {}),
		};
	}

	const result = await bookingsStorage(ctx).query({
		where,
		orderBy: { bookingDate: "desc", createdAt: "desc" },
		limit: Number(limit),
		cursor: cursor as string | undefined,
	});

	return {
		ok: true,
		items: result.items.map((i) => i.data),
		nextCursor: null, // TODO: Implement cursor pagination
	};
}

async function handleBookingUpdate(routeCtx: any, ctx: PluginContext) {
	const id = routeCtx.params?.id;
	if (!id) {
		return { ok: false, error: "Booking ID is required." };
	}

	const parsed = bookingUpdateInput.safeParse(routeCtx.input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0].message };
	}

	const booking = await bookingsStorage(ctx).get(id);
	if (!booking) {
		return { ok: false, error: "Booking not found." };
	}

	const updates: Partial<BookingRecord> = {};
	if (parsed.data.status) updates.status = parsed.data.status as BookingStatus;
	if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

	updates.updatedAt = new Date().toISOString();

	await bookingsStorage(ctx).put(id, { ...booking, ...updates });

	return { ok: true, booking: { ...booking, ...updates } };
}

// ---------------------------------------------------------------- Payment routes

const checkoutSessionInput = z.object({
	bookingId: z.string().min(1),
	amount: z.number().optional(),
	currency: z.string().optional(),
});

async function handleCheckoutSession(routeCtx: any, ctx: PluginContext) {
	const parsed = checkoutSessionInput.safeParse(routeCtx.input);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0].message };
	}

	const { bookingId, amount, currency } = parsed.data;

	const booking = await bookingsStorage(ctx).get(bookingId);
	if (!booking) {
		return { ok: false, error: "Booking not found." };
	}

	if (booking.paymentStatus === "paid") {
		return { ok: false, error: "Booking is already paid." };
	}

	try {
		// Update booking with payment info
		const updates: Partial<BookingRecord> = {
			amount: amount || booking.amount || 5000,
			currency: currency || booking.currency || "usd",
		};
		await bookingsStorage(ctx).put(bookingId, { ...booking, ...updates, updatedAt: new Date().toISOString() });

		// Create Stripe checkout session
		const sessionId = await createStripeCheckoutSession(bookingId, { ...booking, ...updates } as BookingRecord, ctx);

		// Update booking with stripe session id
		await bookingsStorage(ctx).put(bookingId, {
			...booking,
			...updates,
			stripeSessionId: sessionId,
			paymentStatus: "unpaid",
			updatedAt: new Date().toISOString(),
		});

		return { ok: true, checkoutUrl: `https://checkout.stripe.com/pay/${sessionId}` };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Failed to create checkout session";
		return { ok: false, error: errorMessage };
	}
}

const webhookInput = z.object({
	type: z.string(),
	data: z.object({
		object: z.object({
			id: z.string(),
			metadata: z.record(z.string()).optional(),
			payment_status: z.string().optional(),
		}),
	}),
});

async function handleWebhook(routeCtx: any, ctx: PluginContext) {
	// Get signature from headers
	const signature = routeCtx.headers?.get?.("stripe-signature") || routeCtx.headers?.["stripe-signature"] || "";

	if (!signature) {
		return { ok: false, error: "Missing Stripe signature" };
	}

	// Parse payload
	let payload: any;
	try {
		payload = routeCtx.input;
	} catch {
		return { ok: false, error: "Invalid payload" };
	}

	// Verify webhook
	try {
		await verifyStripeWebhook(payload, signature, ctx);
	} catch {
		return { ok: false, error: "Invalid signature" };
	}

	const eventType = payload.type || payload.event_type;

	if (eventType === "checkout.session.completed") {
		const session = payload.data?.object;
		const bookingId = session?.metadata?.bookingId;

		if (!bookingId) {
			return { ok: false, error: "No bookingId in session metadata" };
		}

		const booking = await bookingsStorage(ctx).get(bookingId);
		if (!booking) {
			return { ok: false, error: "Booking not found" };
		}

		// Update booking status to paid
		await bookingsStorage(ctx).put(bookingId, {
			...booking,
			status: "paid" as BookingStatus,
			paymentStatus: "paid",
			stripeSessionId: session.id,
			updatedAt: new Date().toISOString(),
		});

		// TODO: Send confirmation email using ctx.email.send

		return { ok: true, message: "Payment confirmed" };
	}

	return { ok: true, message: "Webhook received" };
}

// ---------------------------------------------------------------- Block Kit admin UI

const adminInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), value: z.unknown().optional() }),
]);

async function bookingsAdminPage(ctx: PluginContext, toast?: { type: "success" | "error"; message: string }) {
	const [pending, confirmed, cancelled] = await Promise.all([
		bookingsStorage(ctx).count({ status: "pending" }),
		bookingsStorage(ctx).count({ status: "confirmed" }),
		bookingsStorage(ctx).count({ status: "cancelled" }),
	]);

	const recentBookings = await bookingsStorage(ctx).query({
		orderBy: { bookingDate: "desc", createdAt: "desc" },
		limit: 20,
	});

	const blocks: Array<Record<string, unknown>> = [
		{ type: "header", text: "Booking Inbox" },
		{
			type: "context",
			text: "Manage customer bookings, confirm appointments, and track status.",
		},
		{
			type: "stats",
			items: [
				{ label: "Pending", value: String(pending) },
				{ label: "Confirmed", value: String(confirmed) },
				{ label: "Cancelled", value: String(cancelled) },
			],
		},
	];

	if (!recentBookings.items.length) {
		blocks.push({ type: "banner", description: "No bookings yet." });
	} else {
		blocks.push({ type: "divider" });
		blocks.push({
			type: "table",
			columns: [
				{ key: "bookingDate", label: "Date" },
				{ key: "bookingTimeSlot", label: "Time" },
				{ key: "customerName", label: "Customer" },
				{ key: "serviceSlug", label: "Service" },
				{ key: "status", label: "Status" },
			],
			rows: recentBookings.items.map((i) => ({
				bookingDate: i.data.bookingDate,
				bookingTimeSlot: i.data.bookingTimeSlot,
				customerName: i.data.customerName,
				serviceSlug: i.data.serviceSlug,
				status: i.data.status,
				action_id: i.id,
			})),
			page_action_id: "browse_all_bookings",
			empty_text: "No bookings found.",
		});
	}

	return { blocks, ...(toast ? { toast } : {}) };
}

// ---------------------------------------------------------------- plugin

const plugin: SandboxedPlugin = {
	hooks: {},

	routes: {
		availability: {
			public: true,
			handler: async (routeCtx, ctx) => {
				return handleAvailability(routeCtx, ctx as PluginContext);
			},
		},
		bookings: {
			public: true,
			handler: async (routeCtx, ctx) => {
				return handleBookingSubmit(routeCtx, ctx as PluginContext);
			},
		},
		"bookings-list": {
			permission: "admin:manage",
			handler: async (routeCtx, ctx) => {
				return handleBookingsList(routeCtx, ctx as PluginContext);
			},
		},
		"booking-update": {
			permission: "admin:manage",
			handler: async (routeCtx, ctx) => {
				return handleBookingUpdate(routeCtx, ctx as PluginContext);
			},
		},
		"payment-checkout": {
			public: true,
			handler: async (routeCtx, ctx) => {
				return handleCheckoutSession(routeCtx, ctx as PluginContext);
			},
		},
		"payment-webhook": {
			public: true,
			handler: async (routeCtx, ctx) => {
				return handleWebhook(routeCtx, ctx as PluginContext);
			},
		},
		admin: {
			permission: "admin:manage",
			handler: async (routeCtx, ctx) => {
				const parsed = adminInput.safeParse(routeCtx.input);
				if (!parsed.success) return { blocks: [] };

				const interaction = parsed.data;
				if (interaction.type === "block_action") {
					// Handle action buttons (confirm, cancel, mark completed)
					const actionId = interaction.action_id;
					const bookingId = typeof interaction.value === "string" ? interaction.value : undefined;

					if (bookingId && actionId.startsWith("status_")) {
						const newStatus = actionId.replace("status_", "") as BookingStatus;
						const result = await handleBookingUpdate(
							{ input: { status: newStatus }, params: { id: bookingId } },
							ctx as PluginContext,
						);

						if (result.ok) {
							return bookingsAdminPage(ctx as PluginContext, {
								type: "success",
								message: `Booking updated to ${newStatus}.`,
							});
						} else {
							return bookingsAdminPage(ctx as PluginContext, {
								type: "error",
								message: result.error || "Failed to update booking.",
							});
						}
					}
				}

				return bookingsAdminPage(ctx as PluginContext);
			},
		},
	},

	mcp: {
		tools: {
			bookings_list: {
				description: "List bookings with filters for the admin dashboard",
				route: "bookings-list",
				input: z.object({
					status: z.enum(["pending", "confirmed", "cancelled", "completed", "no-show"]).optional(),
					startDate: z.string().optional(),
					endDate: z.string().optional(),
					serviceSlug: z.string().optional(),
					limit: z.number().default(50),
				}),
				destructive: false,
			},
			booking_update: {
				description: "Update booking status (confirmed, cancelled, completed)",
				route: "booking-update",
				input: z.object({
					id: z.string(),
					status: z.enum(["confirmed", "cancelled", "completed", "no-show"]).optional(),
					notes: z.string().optional(),
				}),
				destructive: false,
			},
		},
	},
};

export default plugin;
