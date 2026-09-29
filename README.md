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
npm test         # guard-rule + QR encoder checks (no database needed)
```

Without `DATABASE_URL` the API runs in a clearly-labelled **in-memory demo** mode
(survives only for the lifetime of the dev server) and every order response is
tagged `storage.durable: false`. No order is ever fake-stored.

## Checks

There is no test runner. `npm test` runs two plain Node scripts; every check runs
even if an earlier one fails, and the process exits non-zero if any failed. Both
work against the in-memory store, so neither needs a database or a network.

| Script | What it pins down |
| --- | --- |
| `dev/checkGuards.mjs` | 48 checks over the guard rules: order-token ownership, UTR normalisation, admin auth (unauthenticated, forged cookie, no session secret), status-transition legality, `PAID` reachable only by admin, and that COD never asks the customer to pay online |
| `dev/checkQr.mjs` | Decodes the server-generated UPI QR with **jsQR** — an independent implementation — across every payload length 1..213, several error-correction levels, and realistic `upi://pay` intent strings |

The QR encoder in `api/_lib/qr.js` is hand-written, so it is deliberately checked
against a decoder that is not itself rather than against its own output.

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
| POST | `/api/admin/login` / `/api/admin/session` | Supabase sign-in and session probe for `/admin` |
| GET | `/api/admin/orders` | Admin order list, filters, counts, pagination |
| GET/PATCH | `/api/admin/orders/:orderId` | Order detail, verify a UTR, advance order status |

Admin routes require a valid session cookie and fail closed with a 500-style
`ApiError` when `JOC_ADMIN_SESSION_SECRET` is unset. `/admin` is a real path, not
a hash route, and `vercel.json` sends `X-Robots-Tag: noindex` on it.

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

### What is and is not a secret

Only four things here are secret: `DATABASE_URL` (it embeds the DB password),
`JOC_ADMIN_SESSION_SECRET`, `RESEND_API_KEY`, and `RAZORPAY_KEY_SECRET` — the
last only if you ever enable Razorpay. Commit none of them.

`JOC_UPI_ID` and `SUPABASE_ANON_KEY` look sensitive but are not:
`JOC_UPI_ID` is printed on the checkout page and embedded in the payment QR by
design, and the Supabase anon key only allows exchanging a password for a
session, with RLS enabled and no policies so it cannot read a single row.

`.env`, `.env.local` and `.env*.local` are git-ignored and `.env.example` is the
only environment file tracked in the repository. Nothing under this project
should ever carry a real key. The Razorpay *publishable* key id is not a secret
either, and it is deliberately absent from the browser bundle: `/api/payments/create`
serves it per request.

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
api/_lib/       Shared server code: store, schema, payments, QR, admin auth, notify
api/admin/      Admin-only routes (login, session, order list/detail)
db/schema.sql   Postgres schema (orders table, indexes, updated trigger)
db/migrations/  Ordered migrations for an existing database (002 payment/admin, 003 COD)
shared/         Contract imported by frontend and API
src/admin/      Admin dashboard (lazy-loaded; never requested by a customer)
src/cart/       Cart context, localStorage persistence
src/lib/        Hash routing, API client, Razorpay loader, order flow state machine
src/components/cart/    Cart page
src/components/order/   Checkout + confirmation/failure screens
dev/            Local-only /api bridge for the Vite dev server, plus npm test checks
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
3. Confirm the **production order-handling process** (who receives orders, and how).
4. Replace the illustrations with real photography.
5. Replace the temporary wordmark with the official logo.
6. Swap the developer's contact details for the business's own, in
   `src/data/business.js`.
7. Create the production Supabase project and add `DATABASE_URL`.
8. Confirm `JOC_UPI_ID` on the production deployment by reading
   `GET /api/payments/methods` — it should report `provider: manual_upi` with
   both Cash on Delivery and UPI available.
9. Run `npm test` and `npm run lint` against the final state.
10. Add the live domain as `<link rel="canonical">` and a real 1200×630 OG image.
11. Remove the concept/demo wording from the hero, contact section and footer.
12. Decide the order-status workflow (`RECEIVED → … → DELIVERED` is already
    modelled and enforced server-side, and editable from `/admin/orders`).

> Razorpay is **not** required to go live. It stays behind the provider
> abstraction; only set `JOC_PAYMENT_PROVIDER=razorpay`, add the key pair and set
> `RAZORPAY_TEST_MODE=false` if you later decide to use it instead. Run a real ₹2
> test payment first.