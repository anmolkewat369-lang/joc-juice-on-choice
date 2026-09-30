# JOC — Juice On Choice

The JOC Juice and Cafe website for Dixit Colony, Marhatal, Jabalpur, with guest
ordering (cart → checkout → confirmation), customer order tracking, and
server-side order storage. Menu and prices are based on the current public listing
and may change.

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

There is no test runner. `npm test` runs plain Node scripts; every check runs
even if an earlier one fails, and the process exits non-zero if any failed. All of
them work against the in-memory store, so none needs a database or a network.

| Script | What it pins down |
| --- | --- |
| `dev/checkGuards.mjs` | 53 checks over the guard rules: order-token ownership, UTR normalisation, admin auth (unauthenticated, forged cookie, no session secret), status-transition legality, `PAID` reachable only by admin, the checkout field-error contract, and that COD never asks the customer to pay online |
| `dev/checkDelivery.mjs` | 26 checks on the 4 km rule: inclusive metre comparison, clamped radius input, every refusal outcome, fail-closed behaviour when Google is missing/broken/unconfigured, the order route refusing out-of-range orders, idempotent replay, and that the customer cannot post their own verdict |
| `dev/checkNotifications.mjs` | 17 checks on the send ledger: exactly-once under repeated and concurrent triggers, distinct-status dedupe, skipped-vs-failed recording, a broken provider never failing an order, an unreachable ledger still sending, and the tracking token never appearing in a payload |
| `dev/checkQr.mjs` | Decodes the server-generated UPI QR with **jsQR** — an independent implementation — across every payload length 1..213, several error-correction levels, and realistic `upi://pay` intent strings |

The QR encoder in `api/_lib/qr.js` is hand-written, so it is deliberately checked
against a decoder that is not itself rather than against its own output.

The delivery and notification suites stub `fetch`, not the module that calls it,
so the real `checkDelivery`, the real Resend transport and the real ledger are all
exercised; only the network is replaced. `dev/checkGuards.mjs` stubs Google the same
way, which is what lets the mandatory delivery check stay mandatory in every
end-to-end order case.

## How ordering works

- **Routes**: `#/cart`, `#/checkout`, `#/order/<orderId>` live in their own hash
  namespace. The existing homepage sections and anchors are untouched.
- **Shared contract**: `shared/ordering.js` and `shared/delivery.js` are imported by
  both the frontend and the API so price calculation, limits, phone validation,
  delivery wording and the distance rule cannot drift.
- **Server-side prices**: the API recomputes every total from `src/data/menu.js`
  and rejects unknown ids or quantities. The localStorage cart is a shopping bag,
  never the database.
- **Idempotency**: every submission carries an `Idempotency-Key`; a double click,
  refresh or retry resolves to the same order. The replay is resolved *before* the
  delivery check, so re-sending a request never costs a Google call and never
  invalidates an order already placed.
- **Delivery area**: 4 km of driving distance, measured by the Google Routes API
  and compared in whole metres. See [The delivery rule](#the-delivery-rule).
- **Order lookup**: order ids (e.g. `JOC-20260928-0001`) are public, so lookup
  requires a per-order secret. It is returned once at creation, kept in
  `sessionStorage`, and sent as an `X-Order-Token` header (never in the URL).
- **Tracking links**: a customer's email carries
  `https://site/#/order/<id>?t=<token>`. The token sits in the URL *fragment*, so it
  is never sent in a request line, never lands in an access log and never reaches
  a Referer header. It is the same per-order secret, so this is not a weaker path
  into the order.
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
- **The browser is never trusted with money or with delivery**: totals are priced
  server-side from the shared menu, `payment_provider` and `payment_status` are
  stamped server-side, the UPI ID/amount/deep link/QR are built by the server, and
  the delivery distance is measured and stored by the server at order time.
- **Failure is honest**: a failed/cancelled payment lands on an explicit failure
  screen, never a fake success, with Retry and Change-to-COD options that operate
  on the same stored order.

## The delivery rule

JOC delivers only within a fixed driving distance of the store. This is the one
rule a customer can argue with, so it is worth being precise about what it is.

- **It is a road distance.** `api/_lib/googleMaps.js` geocodes the typed address
  and asks the Google Routes API for the `DRIVE` distance, `TRAFFIC_UNAWARE` so the
  same address always measures the same. There is deliberately no Haversine
  helper anywhere in the project — a straight-line figure is a lower bound, and
  shipping one next to the real rule is how a crow-flies radius quietly becomes
  the delivery policy.
- **It is inclusive.** `distanceMeters <= radiusMeters`, compared as integers, so
  an address exactly at 4000 m is deliverable and float noise cannot reject
  someone standing on the boundary.
- **It fails closed.** A missing key, missing store coordinates, an address Google
  cannot place, an ambiguous address, a timeout or a quota error all produce "we
  cannot deliver to that address" — never "allowed". An outage of this dependency
  must never widen the delivery area.
- **It is enforced in one place.** `api/_lib/delivery.js` is the only module that
  answers the question, and `POST /api/orders` calls it itself. `POST
  /api/delivery/check` is the checkout preview only; a caller cannot pass it a
  friendly answer and then post something else, because the order route re-measures
  from the request body.
- **The measured distance is stored** on the order, so a later change to
  `JOC_DELIVERY_RADIUS_KM` cannot silently reinterpret an order that was already
  accepted, and so the admin dashboard shows the figure that decided the order.
- **The cost is not affected.** `DELIVERY_CHARGE` stays 0 and the UI says "To be
  confirmed" — the area is being restricted, not the price being raised.
- **It fits the function budget.** `vercel.json` sets `maxDuration: 30` for
  `api/**`. The order route's worst case is two sequential Google calls (8 s
  timeout each) followed by a Resend send; at the previous 15 s a slow provider
  surfaced to the customer as a network error instead of an honest refusal.

Configuring it: `GOOGLE_MAPS_API_KEY` (with the **Geocoding API** and **Routes API**
enabled), `JOC_STORE_LATITUDE`, `JOC_STORE_LONGITUDE` and optionally
`JOC_DELIVERY_RADIUS_KM`. Get the coordinates from Google Maps for the store — do
not guess them; a wrong pin moves the whole delivery area and nothing in the app
can tell you it is wrong.

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/orders` | Create a COD or UPI order (delivery verified server-side first) |
| GET | `/api/orders/:orderId` | Look up an order (token required) |
| POST | `/api/orders/utr` | Submit a UTR (token required) — can only reach `PAYMENT_VERIFICATION_REQUIRED` |
| POST | `/api/delivery/check` | Checkout preview of the delivery area (not a gate) |
| GET | `/api/delivery/config` | The radius this deployment is actually enforcing |
| GET | `/api/payments/methods` | What this deployment can actually offer |
| POST | `/api/payments/create` | Start a gateway session for an order |
| POST | `/api/payments/verify` | Server-verified payment success |
| POST | `/api/payments/cancel` | Mark failed/cancelled, or convert to COD |
| POST | `/api/admin/login` / `/api/admin/session` | Supabase sign-in and session probe for `/admin` |
| GET | `/api/admin/orders` | Admin order list, filters, counts, pagination |
| GET/PATCH | `/api/admin/orders/:orderId` | Order detail, verify a UTR, advance order status, notification audit rows |

Vercel's Hobby plan allows 12 serverless functions per deployment, so
`/api/delivery/config` is served by `api/delivery/check.js` and
`/api/payments/methods` by `api/payments/create.js`. Both keep the URL above:
`vercel.json` rewrites each alias onto the file that also serves the POST route,
and the handler tells the two requests apart by path. The answers are unchanged —
the alias is still a public read with no token, and the POST routes still
require the order's own `X-Order-Token`.

Admin routes require a valid session cookie and fail closed with a 500-style
`ApiError` when `JOC_ADMIN_SESSION_SECRET` is unset. `/admin` is a real path, not
a hash route, and `vercel.json` sends `X-Robots-Tag: noindex` on it.

## Notifications

Email is optional and is never allowed to affect whether an order succeeds.

- **A notification cannot fail an order.** The order is committed before any
  message is sent, every send is wrapped, and a failure is recorded rather than
  thrown. A misconfigured Resend key costs you an email, never an order.
- **At most one message per fact.** `joc_notifications` is unique on
  `(order_uuid, notification_type, dedupe_key)` and the send is claim-then-send, so
  two dashboard clicks, a retrying webhook or a crashed invocation cannot produce a
  duplicate. Three attempts maximum, then it is an operator problem.
- **Skipped is not failed.** No customer address, or no mail configured, is
  recorded as `skipped` once, so a later status change does not re-decide the same
  question — and nobody gets a surprise send the moment a setting is fixed.
- **The admin can see what went out.** The order drawer lists the ledger with
  masked recipients (`a•••••@gmail.com`), so "did they get the message?" is
  answerable on screen without reading logs.
- **WhatsApp is not configured.** No automated WhatsApp messages are sent. Any
  future integration requires an official JOC business number and a separate
  provider implementation.

## Environment

Copy `.env.example` → `.env.local` for local development. All values are
**server-side**; there is deliberately no `VITE_` key.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For durable orders | Supabase Postgres (use the transaction pooler for Vercel) |
| `JOC_AUTO_MIGRATE` | Optional | `true` lets the API run the schema + migrations on first request; set `false` if you provision it yourself |
| `JOC_ALLOW_MEMORY_STORE` | Optional | Only needed to force in-memory mode on a production build |
| `GOOGLE_MAPS_API_KEY` | **Required to take any order** | Server-only secret. Needs the Geocoding API and Routes API enabled |
| `JOC_STORE_LATITUDE` / `JOC_STORE_LONGITUDE` | **Required to take any order** | Decimal degrees for the store. Get them from Google Maps; do not guess |
| `JOC_DELIVERY_RADIUS_KM` | Optional | Defaults to `4`; clamped to 0.5–50 so a typo cannot open or close the area |
| `JOC_SITE_URL` | Optional | Base URL for emailed tracking links. Defaults to the production URL |
| `JOC_PAYMENT_PROVIDER` | Optional | `manual_upi` (default) or `razorpay`. Selects which rail settles a digital payment |
| `JOC_UPI_ID` | **For the UPI option at checkout** | The JOC UPI handle. **Not a secret** — it is shown to customers and embedded in the payment QR. Without it, checkout offers Cash on Delivery only |
| `JOC_ADMIN_SESSION_SECRET` | For `/admin` | ≥32 chars, random. Signs the admin session cookie. Never commit |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | For `/admin` | Supabase Auth only. The anon key cannot read any table (RLS is enabled with no policies) |
| `JOC_ADMIN_EMAILS` | Optional | Allow-list. Empty means any user who can sign in |
| `JOC_NOTIFY_EMAIL` / `JOC_NOTIFY_FROM` / `RESEND_API_KEY` | Optional | Email notifications. All three needed; the key is a secret |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Only if provider is `razorpay` | `rzp_test_...` / `rzp_live_...`. The secret must never be committed |
| `RAZORPAY_TEST_MODE` | Optional | Defaults `true`; live money only when explicitly `false` AND live keys are set |

> **No order is accepted at all?** Almost always the delivery check: check
> `GOOGLE_MAPS_API_KEY`, the store coordinates, and that both Google APIs are
> enabled on the key. It fails closed by design, so a misconfiguration refuses
> every order rather than accepting all of them. `GET /api/delivery/config` reports
> the radius the server is enforcing, and a refused `POST /api/orders` returns a
> `422` whose `detail.code` is `delivery_unavailable` — the reason the customer is
> shown is the same reason the order was refused.

> **Checkout shows Cash on Delivery only?** Check `JOC_UPI_ID` first. It is the
> single variable that decides whether the UPI option appears, and the checkout
> says "Online payment is unavailable right now" whenever it is missing or
> malformed. `GET /api/payments/methods` reports exactly what the server offers,
> which is the fastest way to confirm a deployment's configuration.

### What is and is not a secret

Only five things here are secret: `DATABASE_URL` (it embeds the DB password),
`GOOGLE_MAPS_API_KEY`, `JOC_ADMIN_SESSION_SECRET`, `RESEND_API_KEY`, and
`RAZORPAY_KEY_SECRET` — the last only if you ever enable Razorpay. Commit none of
them.

`JOC_UPI_ID` and `SUPABASE_ANON_KEY` look sensitive but are not:
`JOC_UPI_ID` is printed on the checkout page and embedded in the payment QR by
design, and the Supabase anon key only allows exchanging a password for a
session, with RLS enabled and no policies so it cannot read a single row.

`.env`, `.env.local` and `.env*.local` are git-ignored and `.env.example` is the
only environment file tracked in the repository. Nothing under this project
should ever carry a real key. The Razorpay *publishable* key id is not a secret
either, and it is deliberately absent from the browser bundle: `/api/payments/create`
serves it per request.

The order access secret is handled the same way: the database stores only a hash
of it, it is returned to the customer exactly once, and it is never included in an
admin payload, an event, a log line or a tracking link that is not already
fragment-scoped.

### Setup steps

1. **Database (Supabase)**: create a project, copy its Postgres connection string
   into `DATABASE_URL`, then either keep `JOC_AUTO_MIGRATE=true` (the API applies
   the schema and all migrations itself on first request) or set
   `JOC_AUTO_MIGRATE=false` and run `db/schema.sql` on a **new** database — or the
   files in `db/migrations/` in order on an **existing** one, in the SQL editor.
2. **Delivery area (do this before any order can be placed)**: create a Google
   Cloud key with the **Geocoding API** and **Routes API** enabled and set
   `GOOGLE_MAPS_API_KEY`. Then look the store up in Google Maps, copy the
   coordinates off the pin, and set `JOC_STORE_LATITUDE` / `JOC_STORE_LONGITUDE`.
  `JOC_DELIVERY_RADIUS_KM` defaults to 4. Verify with
   `GET /api/delivery/config`, then place one real test order from a nearby and a
   far address and confirm the two verdicts.
3. **Payments**: set `JOC_PAYMENT_PROVIDER=manual_upi` and `JOC_UPI_ID` to your
   `handle@bank`. Customers pay that ID, submit the UTR, and an admin verifies it
   at `/admin/orders`. Razorpay stays behind the same provider abstraction: switch
   `JOC_PAYMENT_PROVIDER` to `razorpay` and add the key pair to use it instead.
4. **Admin**: set `JOC_ADMIN_SESSION_SECRET`, `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, then sign in at `/admin`. The dashboard is where a UPI
   payment moves from `PAYMENT_VERIFICATION_REQUIRED` to `PAID`.
5. **Notifications (optional)**: set `RESEND_API_KEY`, a Resend-verified
   `JOC_NOTIFY_FROM`, and `JOC_NOTIFY_EMAIL` for the admin alert. Customer
   confirmations go to whatever address the customer typed at checkout. Unset,
   everything else keeps working and the ledger records the skips.
6. **Vercel**: connect the repo, add the environment variables for Preview and
   Production, and set the build command/root from `vercel.json`. The API
   functions deploy as serverless routes automatically.

## Project layout

```
api/            Vercel serverless functions (orders, payments, delivery)
api/_lib/       Shared server code: store, schema, payments, QR, admin auth,
                Google Maps + the delivery decision, email, notifications
api/admin/      Admin-only routes (login, session, order list/detail)
db/schema.sql   Postgres schema (orders, notifications, indexes, updated trigger)
db/migrations/  Ordered migrations for an existing database (002 payment/admin,
                003 COD, 004 delivery + email + notifications)
shared/         Contract imported by frontend and API (ordering, delivery)
src/admin/      Admin dashboard (lazy-loaded; never requested by a customer)
src/cart/       Cart context, localStorage persistence
src/lib/        Hash routing, API client, Razorpay loader, order flow state machine
src/components/cart/    Cart page
src/components/order/   Checkout, delivery preview, confirmation/tracking/failure
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
| **Delivery radius + customer-facing delivery wording** | `shared/delivery.js`, plus `JOC_DELIVERY_RADIUS_KM` |
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
2. **Apply `db/migrations/004_delivery_and_notifications.sql` before deploying the
   code that writes those columns.** Use the Supabase SQL editor (or the direct
   connection), not the transaction pooler — poolers will not run a multi-statement
   migration file. Production should have `JOC_AUTO_MIGRATE=false`.
3. Confirm the **production order-handling process** (who receives orders, and how).
4. Replace the illustrations with real photography.
5. Replace the temporary wordmark with the official logo.
6. Swap the developer's contact details for the business's own, in
   `src/data/business.js`.
7. Create the production Supabase project and add `DATABASE_URL`.
8. Confirm `JOC_UPI_ID` on the production deployment by reading
   `GET /api/payments/methods` — it should report `provider: manual_upi` with
   both Cash on Delivery and UPI available.
9. Confirm `GET /api/delivery/config` reports the radius you expect, and that a
   test order from a known-nearby address is accepted while a known-far address is
   refused. This is the one rule where "it looks fine in the browser" is not
   evidence.
10. Set `JOC_SITE_URL` to the real domain, so tracking links in customer emails
    point at production.
11. Run `npm test` and `npm run lint` against the final state.
12. Add the live domain as `<link rel="canonical">` and a real 1200×630 OG image.
13. Remove the concept/demo wording from the hero, contact section and footer.
14. Decide the order-status workflow (`RECEIVED → … → DELIVERED` is already
    modelled and enforced server-side, and editable from `/admin/orders`).

> Razorpay is **not** required to go live. It stays behind the provider
> abstraction; only set `JOC_PAYMENT_PROVIDER=razorpay`, add the key pair and set
> `RAZORPAY_TEST_MODE=false` if you later decide to use it instead. Run a real ₹2
> test payment first.