# Booking Service Demo Site

A demo website for the EmDash booking module, showcasing appointment scheduling functionality.

## Setup

1. Ensure the `@astro-cms/plugin-booking` plugin is installed and configured in `astro.config.mjs`.
2. Set up a PostgreSQL database and set the `DATABASE_URL` environment variable.
3. Run the development server:

```bash
npm run dev
```

## Features

- Service selection with duration
- Date picker with availability checking
- Time slot grid selection
- Customer details form with honeypot spam protection
- Booking status management via admin UI

## Demo Services

- Initial Consultation (30 min)
- Strategy Session (60 min)
- Follow-up Meeting (30 min)
