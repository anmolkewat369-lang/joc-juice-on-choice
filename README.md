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
- A **payment provider abstraction** (`api/_lib/payments.js`) with two rails:
  - **Manual UPI** (current): the customer pays your UPI ID, submits the UTR, and
    an admin verifies it. No gateway, no secrets, no SDK.
  - **Razorpay Standard Checkout** (future): server-side signature verification,
    no SDK. Select it with `JOC_PAYMENT_PROVIDER=razorpay`.

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
- **Payments**: the provider is chosen by `JOC_PAYMENT_PROVIDER` and the checkout
  offers a digital option only when that provider is genuinely usable — an option
  that cannot take money is never shown. Cash on Delivery is always offered.
- **A UTR is a claim, not proof**: submitting a transaction reference can only
  ever move an order to `PAYMENT_VERIFICATION_REQUIRED`. There is no request
  field, query parameter or code path a customer can reach that produces `PAID`.
- **Only two things can mark a payment `PAID`**: a verified gateway signature
  (`/api/payments/verify`, matching order id, gateway-confirmed paid, amount
  match) or an authenticated admin at `/admin/orders`. Both write
  `payment_verified_at` / `payment_verified_by` and an audit row.
- **The browser is never trusted with money**: totals are priced server-side from
  the shared menu, `payment_provider` and `payment_status` are stamped
  server-side, and the UPI ID, amount, deep link and QR in the confirmation view
  are all built by the server.
- **Failure is honest**: a failed/cancelled payment lands on an explicit failure
  screen, never a fake success, with Retry and Change-to-COD options that operate
  on the same stored order.

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/orders` | Create a COD or UPI order |
| GET | `/api/orders/:orderId` | Look up an order (token required) |
| POST | `/api/orders/utr` | Submit a UTR (token required) — can only reach `PAYMENT_VERIFICATION_REQUIRED` |
| GET | `/api/payments/methods` | What this deployment can actually offer |
| POST | `/api/payments/create` | Start a gateway session for an order |
| POST | `/api/payments/verify` | Server-verified payment success |
| POST | `/api/payments/cancel` | Mark failed/cancelled, or convert to COD |

## Environment

Copy `.env.example` → `.env.local` for local development. All values are
**server-side**; there is deliberately no `VITE_` key.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For durable orders | Supabase Postgres (use the transaction pooler for Vercel) |
| `JOC_AUTO_MIGRATE` | Optional | `true` lets the API run the schema + migrations on first request; set `false` if you provision it yourself |
| `JOC_ALLOW_MEMORY_STORE` | Optional | Only needed to force in-memory mode on a production build |
| `JOC_PAYMENT_PROVIDER` | Optional | `manual_upi` (default) or `razorpay`. Selects which rail settles a digital payment |
| `JOC_UPI_ID` | **For the UPI option at checkout** | `handle@bank`, e.g. `9630194023@pthdfc`. **Not a secret** — it is shown to customers and embedded in the payment QR. Without it, checkout offers Cash on Delivery only |
| `JOC_ADMIN_SESSION_SECRET` | For `/admin` | ≥32 chars, random. Signs the admin session cookie. Never commit |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | For `/admin` | Supabase Auth only. The anon key cannot read any table (RLS is enabled with no policies) |
| `JOC_ADMIN_EMAILS` | Optional | Allow-list. Empty means any user who can sign in |
| `JOC_WHATSAPP_NUMBER` | Optional | `919630194023`-style digits, no `+`. Builds the admin's WhatsApp deep link |
| `JOC_NOTIFY_EMAIL` / `JOC_NOTIFY_FROM` / `RESEND_API_KEY` | Optional | Email notifications. All three needed; the key is a secret |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Only if provider is `razorpay` | `rzp_test_...` / `rzp_live_...`. The secret must never be committed |
| `RAZORPAY_TEST_MODE` | Optional | Defaults `true`; live money only when explicitly `false` AND live keys are set |

> **Checkout shows Cash on Delivery only?** Check `JOC_UPI_ID` first. It is the
> single variable that decides whether the UPI option appears, and the checkout
> says "Online payment is unavailable right now" whenever it is missing or
> malformed. `GET /api/payments/methods` reports exactly what the server offers,
> which is the fastest way to confirm a deployment's configuration.

### Setup steps

1. **Database (Supabase)**: create a project, copy its Postgres connection string
   into `DATABASE_URL`, then either keep `JOC_AUTO_MIGRATE=true` (the API applies
   the schema and all migrations itself on first request) or set
   `JOC_AUTO_MIGRATE=false` and run `db/schema.sql` on a **new** database — or the
   files in `db/migrations/` in order on an **existing** one, in the SQL editor.
2. **Payments**: set `JOC_PAYMENT_PROVIDER=manual_upi` and `JOC_UPI_ID` to your
   `handle@bank`. Customers pay that ID, submit the UTR, and an admin verifies it
   at `/admin/orders`. Razorpay stays behind the same provider abstraction: switch
   `JOC_PAYMENT_PROVIDER` to `razorpay` and add the key pair to use it instead.
3. **Admin**: set `JOC_ADMIN_SESSION_SECRET`, `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, then sign in at `/admin`. The dashboard is where a UPI
   payment moves from `PAYMENT_VERIFICATION_REQUIRED` to `PAID`.
4. **Vercel**: connect the repo, add the environment variables for Preview and
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