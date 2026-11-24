# Demo Modules Planning Document

This document outlines the planned demo modules to stress-test the EmDash CMS and identify feature gaps for common agency website requests.

## Completed Modules

### 1. Booking / Appointment Scheduling ✅
- **Demo site:** `spike/demo-sites/booking-service/`
- **Plugin:** `spike/emdash-site/plugins/booking-plugin/`
- **Features:** Time slot availability, booking submission, admin inbox, status management
- **Status:** Implemented with deployment scripts for dev-215

---

## Planned Modules

### 2. E-commerce / Product Catalog
**Purpose:** Test product management, inventory tracking, and shopping cart functionality

**Demo site:** `spike/demo-sites/ecommerce-shop/`

**Modules needed:**
- Product collection with variants (size, color, price)
- Product categories and tags (taxonomies)
- Shopping cart state management
- Checkout flow
- Payment integration (Stripe/PayPal)
- Inventory tracking

**CMS features to test:**
- Collection with complex fields (variants, pricing)
- Media library for product images
- Taxonomy for categories
- Custom routes for product listing and detail pages

**Payment integration requirements:**
- Stripe checkout session creation
- Webhook handling for payment confirmation
- Order status management

---

### 3. Lead Generation Landing Page
**Purpose:** Test multi-step forms, conversion tracking, and A/B testing capabilities

**Demo site:** `spike/demo-sites/lead-gen-landing/`

**Modules needed:**
- Multi-step form wizard
- Conversion tracking pixels (Google Analytics, Meta Pixel)
- A/B testing variants
- CRM integration (HubSpot, Mailchimp)
- Thank you/confirmation pages

**CMS features to test:**
- Advanced form handling with state management
- Custom script injection for tracking pixels
- Page variant management
- Lead data storage and export

---

### 4. Restaurant / Menu Site
**Purpose:** Test menu management, reservations, and dietary information

**Demo site:** `spike/demo-sites/restaurant-menu/`

**Modules needed:**
- Menu item management with categories (appetizers, mains, desserts)
- Dietary tags/allergen info (vegan, gluten-free, etc.)
- Reservation booking system (extends booking module)
- Online ordering integration
- Gallery for food photos

**CMS features to test:**
- Hierarchical content (menu categories → items)
- Tag-based filtering (dietary restrictions)
- Media gallery for food images
- Integration with booking module for reservations

---

### 5. Portfolio / Agency Showcase
**Purpose:** Test project galleries, case studies, and client testimonials

**Demo site:** `spike/demo-sites/portfolio-agency/`

**Modules needed:**
- Project collection with case study format
- Client testimonials collection
- Skills/services listing
- Team members collection

**CMS features to test:**
- Rich content rendering (Portable Text)
- Gallery blocks for project images
- Testimonial carousel component
- Team member directory

---

## Implementation Priority

1. **E-commerce / Product Catalog** - High value for agencies, tests complex data structures
2. **Lead Generation Landing Page** - Common request, tests form and tracking capabilities
3. **Restaurant / Menu Site** - Tests integration with booking module and menu management
4. **Portfolio / Agency Showcase** - Already partially covered by HappyMonkey dogfood theme

---

## Payment Integration Design (for Booking & E-commerce)

### Stripe Integration

**Required capabilities:**
- `network:request:unrestricted` (for Stripe API calls)
- `email:send` (for payment confirmations)

**API routes needed:**
- `POST /_emdash/api/plugins/payment/create-checkout-session`
- `POST /_emdash/api/plugins/payment/webhook` (Stripe webhook handler)

**Flow:**
1. User selects service/product and clicks "Book/Buy"
2. Frontend calls `create-checkout-session` API
3. Plugin creates Stripe checkout session with line items
4. Returns checkout URL to frontend
5. User completes payment on Stripe hosted page
6. Stripe sends webhook to plugin
7. Plugin updates booking/order status and sends confirmation email

### PayPal Integration (Alternative)

Similar flow with PayPal Checkout API and webhook handling.

---

## Next Steps

1. Add Stripe payment integration to the booking plugin
2. Build e-commerce demo site with product catalog
3. Create lead generation landing page with multi-step form
4. Test all modules on dev-215 deployment
