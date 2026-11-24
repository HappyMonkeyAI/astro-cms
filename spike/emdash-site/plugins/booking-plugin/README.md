# Booking Plugin for EmDash

Booking and appointment scheduling module for EmDash CMS with Stripe payment integration.

## Features

- Time slot availability calculation
- Booking submission with honeypot spam protection
- Admin booking inbox with Block Kit UI
- Booking status management (pending, paid, confirmed, cancelled, completed, no-show)
- Stripe payment integration with checkout sessions and webhook handling
- MCP tools for booking list and updates

## Installation

Add to your `astro.config.mjs`:

```javascript
import bookingPlugin from "@astro-cms/plugin-booking";

export default defineConfig({
	integrations: [
		emdash({
			database: postgres({ connectionString: process.env.DATABASE_URL }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			plugins: [bookingPlugin()],
		}),
	],
});
```

## Environment Variables

- `STRIPE_SECRET_KEY`: Your Stripe secret key (pk_test_...)
- `STRIPE_WEBHOOK_SECRET`: Your Stripe webhook signing secret (whsec_...)
- `SITE_URL`: Your site URL for checkout success/cancel redirects

## API Routes

### Check Availability
`POST /_emdash/api/plugins/booking/availability`

```json
{
	"serviceSlug": "consultation",
	"date": "2026-12-01"
}
```

### Submit Booking
`POST /_emdash/api/plugins/booking/bookings`

```json
{
	"serviceSlug": "consultation",
	"bookingDate": "2026-12-01",
	"bookingTimeSlot": "10:00-11:00",
	"customerName": "Jane Doe",
	"customerEmail": "jane@example.com",
	"customerPhone": "+1234567890",
	"notes": "Please send link 10 mins before"
}
```

### Create Checkout Session (Payment)
`POST /_emdash/api/plugins/booking/payment/checkout-session`

```json
{
	"bookingId": "booking-uuid",
	"amount": 5000, // Amount in cents (default: 5000 = $50.00)
	"currency": "usd" // Currency code (default: "usd")
}
```

Returns: `{ ok: true, checkoutUrl: "https://checkout.stripe.com/pay/..." }`

### Stripe Webhook
`POST /_emdash/api/plugins/booking/payment/webhook`

Handles `checkout.session.completed` events to update booking status to `paid`.

## Admin UI

Access the booking inbox at `/_emdash/admin/plugins/booking/admin`.
