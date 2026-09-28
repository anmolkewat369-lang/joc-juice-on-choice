# JOC — Juice On Choice · Website Concept

A premium single-page concept website for **JOC Juice and Cafe**, Dixit Colony,
Marhatal, Jabalpur, with a complete guest ordering flow (cart → checkout →
confirmation) and server-side order storage.

> **This is a concept/demo build prepared for a website proposal.** It is not the
> official website of JOC Juice and Cafe. Menu and pricing are demo data taken from
> the business's current public listing and must be confirmed with the business
> before production launch.

## Stack

- React 19 + Vite (single-page app, no router library)
- Plain CSS with design tokens and CSS Modules (no UI framework)
- `lucide-react` for icons
- Serverless API functions under `api/` for Vercel
- `pg` + **Supabase Postgres** for durable order storage (`DATABASE_URL`)
- **Razorpay Standard Checkout** for online payments (server-side verification, no SDK)

## Run it

```bash
npm install
npm run dev      # dev server + local /api bridge (dev/jocApiDevServer.js)
npm run build    # production build to dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

Without `DATABASE_URL` the API runs in a clearly-labelled **in-memory demo** mode
(survives only for the lifetime of the dev server) and every order response is
tagged `storage.durable: false`. No order is ever fake-stored.

## How ordering works

- **Routes**: `#/cart`, `#/checkout`, `#/order/<orderId>` live in their own hash
  namespace. The existing homepage sections and anchors are untouched.
- **Shared contract**: `shared/ordering.js` is imported by both the frontend and
  the API so price calculation, limits, phone validation and delivery rules
  cannot drift.
- **Server-side prices**: the API recomputes every total from `src/data/menu.js`
  and rejects unknown ids or quantities. The localStorage cart is a shopping bag,
  never the database.
- **Idempotency**: every submission carries an `Idempotency-Key`; a double click,
  refresh or retry resolves to the same order.
- **Order lookup**: order ids (e.g. `JOC-20260928-0001`) are public, so lookup
  requires a per-order secret. It is returned once at creation, kept in
  `sessionStorage`, and sent as an `X-Order-Token` header (never in the URL).
- **Payments**: only `/api/payments/verify` can set `paymentStatus` to `PAID`,
  and only after an HMAC signature check, a gateway-order match, and confirmation
  from Razorpay that the amount matches and the payment is actually paid.
- **Failure is honest**: a failed/cancelled payment lands on an explicit failure
  screen, never a fake success, with Retry and Change-to-COD options that operate
  on the same stored order.

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/orders` | Create a COD or online order |
| GET | `/api/orders/:orderId` | Look up an order (token required) |
| POST | `/api/payments/create` | Start a Razorpay session for an order |
| POST | `/api/payments/verify` | Server-verified payment success |
| POST | `/api/payments/cancel` | Mark failed/cancelled, or convert to COD |

## Environment

Copy `.env.example` → `.env.local` for local development. All values are
**server-side**; there is deliberately no `VITE_` key.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For durable orders | Supabase Postgres (use the transaction pooler for Vercel) |
| `JOC_AUTO_MIGRATE` | Optional | `true` lets the API run `db/schema.sql` on first request; set `false` if you provision it yourself |
| `JOC_ALLOW_MEMORY_STORE` | Optional | Only needed to force in-memory mode on a production build |
| `RAZORPAY_KEY_ID` | For Pay Now | `rzp_test_...` or `rzp_live_...` |
| `RAZORPAY_KEY_SECRET` | For Pay Now | The secret — never commit it |
| `RAZORPAY_TEST_MODE` | Optional | Defaults `true`; live money only when explicitly `false` AND live keys are set |

### Setup steps

1. **Database (Supabase)**: create a project, copy its Postgres connection string
   into `DATABASE_URL`, and either run `db/schema.sql` once in the SQL editor or
   keep `JOC_AUTO_MIGRATE=true`.
2. **Payments (Razorpay)**: enable Razorpay in your merchant account, copy the
   Test Mode key pair into `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, and keep the
   default `RAZORPAY_TEST_MODE=true`. Test payments are clearly labelled on the
   confirmation screen.
3. **Vercel**: connect the repo, add the environment variables for Preview and
   Production, and set the build command/root from `vercel.json`. The API
   functions deploy as serverless routes automatically.

## Project layout

```
api/            Vercel serverless functions (orders + payments)
db/schema.sql   Postgres schema (orders table, indexes, updated trigger)
shared/         Contract imported by frontend and API
src/cart/       Cart context, localStorage persistence
src/lib/        Hash routing, API client, Razorpay loader, order flow state machine
src/components/cart/    Cart page
src/components/order/   Checkout + confirmation/failure screens
dev/            Local-only /api bridge for the Vite dev server
```

## Editing the content

All content is data-driven. You should not need to touch a component to change
copy, prices or images.

| What | Where |
| --- | --- |
| Menu items, prices, categories, badges | `src/data/menu.js` |
| Gallery entries | `src/data/gallery.js` |
| Category highlight cards | `src/data/categories.js` |
| Name, address, contact, disclaimer text | `src/data/business.js` |
| **Delivery charge + free-delivery rule** | `shared/ordering.js` (`DELIVERY_CHARGE`, `FREE_DELIVERY_ABOVE`) |
| Design tokens, colours, type scale | `src/index.css` (`:root`) |
| Section styles | `src/components/*.module.css` |

### Swapping illustrations for real photos

Every image is currently a generated SVG illustration in `FoodArt.jsx`. Drop real
files into `public/images/` and set the `image` (menu) or `src` (gallery) field —
the illustration is replaced automatically. See `public/images/README.md`.

### Swapping the logo

The header uses a temporary text wordmark plus a small inline SVG mark. Replace the
`logoMark` block in `src/components/Navbar.jsx` with an `<img>` once the official
JOC logo is supplied.

## Factual content policy

Only verifiable public information is used: business name, address, menu
categories, currently listed items and prices, and the Google Maps location.

Deliberately **not** included anywhere on the site, because none of it is
verified:

- an official JOC phone number or email address
- a JOC Instagram / Facebook / other social handle
- founder or owner names
- establishment year, branch count, awards, reviews or ratings
- "best in Jabalpur" style claims, "#1", or customer counts
- opening hours in the page or in the structured data

The enquiry section routes to the developer's temporary contact details and says
so explicitly. `index.html` contains `CafeOrCoffeeShop` structured data limited to
name, address and category — no phone, no opening hours, no aggregate rating.

## Before going live

1. Confirm the menu, prices and item descriptions with the client.
2. Confirm the **final delivery pricing** and set it in `shared/ordering.js`;
   the current ₹20 flat charge and its note are placeholders.
3. Confirm the **production order-handling process** (who receives orders and how.
4. Replace the illustrations with real photography.
5. Replace the temporary wordmark with the official logo.
6. Swap the developer's contact details for the business's own, in
   `src/data/business.js`.
7. Create the production Supabase project and add `DATABASE_URL`.
8. Create the production Razorpay account, add live keys, and only then set
   `RAZORPAY_TEST_MODE=false`. Run a real ₹2 test payment first.
9. Add the live domain as `<link rel="canonical">` and a real 1200×630 OG image.
10. Remove the concept/demo wording from the hero, contact section and footer.
11. Add an admin view of `joc_orders` (Supabase Table Editor works) and decide the
    order-status workflow (`RECEIVED → … → DELIVERED` is already modelled).