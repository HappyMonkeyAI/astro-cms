# Lead Generation Landing Page Demo

A demo lead generation landing page for the EmDash CMS, showcasing multi-step form wizard and conversion tracking capabilities.

## Setup

1. Ensure EmDash is configured with the appropriate template.
2. Set up a PostgreSQL database and set the `DATABASE_URL` environment variable.
3. Run the development server:

```bash
npm run dev
```

## Features

- Multi-step form wizard (3 steps: Information, Interest, Details)
- Form validation at each step
- Honeypot spam protection
- Conversion tracking placeholders (Google Analytics, Meta Pixel)
- Benefits section to increase conversion rates
- Success state after form submission

## Form Steps

1. **Step 1: Your Information** - Name, email, phone, company
2. **Step 2: Your Interest** - Service interest, estimated budget
3. **Step 3: Additional Details** - Project description, honeypot field

## Next Steps

- Integrate with CRM (HubSpot, Mailchimp)
- Add A/B testing variants
- Implement conversion pixel tracking
- Add form submission analytics
