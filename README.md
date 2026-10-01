# JOC — Juice On Choice

The JOC Juice and Cafe website for Dixit Colony, Marhatal, Jabalpur, with customer
accounts and ordering (cart → checkout → confirmation), order tracking, My Orders,
and server-side order storage. Menu and prices are based on the current public
listing and may change.

## Stack

- React 19 + Vite (single-page app, no router library; account pages are real
  paths served by the SPA fallback)
- Plain CSS with design tokens and CSS Modules (no UI framework)
- `lucide-react` for icons
- Serverless API functions under `api/` for Vercel
- `pg` + **Supabase Postgres** for durable order storage (`DATABASE_URL`)
- **Supabase Auth** for admin sign-in and customer accounts — no password is stored
  by JOC
- `web-push` with VAPID for real browser push (optional, with polling/badge/sound
  as the fallback)
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
npm test         # guard, delivery, notification, customer-auth and push checks (no database needed)
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
| `dev/checkGuards.mjs` | 60 checks over the guard rules: order-token ownership, UTR normalisation, admin auth (unauthenticated, forged cookie, no session secret), status-transition legality, `PAID` reachable only by admin, the checkout field-error contract, area and address-confirmation enforcement, that placing an order makes no outbound call, and that COD never asks the customer to pay online |
| `dev/checkDelivery.mjs` | 34 checks on the delivery-area rule: the list is exactly JOC's 22 areas with these labels in this order, every one is accepted by the server and findable by search (commas included), membership is checked after normalising case and whitespace, prototype keys and the previous provisional names are refused, the confirmation must be exactly `true`, a placed order carries no distance and triggers no outbound request, and **no file under `api/`, `shared/` or `src/` mentions a maps provider, a radius or a coordinate** |
| `dev/checkPostgres.mjs` | 11 checks on the **durable** driver, driven against a stub `pg` pool: `delivery_area` and `delivery_area_confirmed` are in the real `INSERT` with the right values, the customer's name/phone/email/address/landmark/instructions are all still stored, no legacy distance column is written, and a row read back out carries the area, its label, the confirmation, the address and the landmark to the admin |
| `dev/checkNotifications.mjs` | 17 checks on the send ledger: exactly-once under repeated and concurrent triggers, distinct-status dedupe, skipped-vs-failed recording, a broken provider never failing an order, an unreachable ledger still sending, and the tracking token never appearing in a payload |
| `dev/checkCustomerAuth.mjs` | 18 checks on customer accounts: a session cannot be minted without a secret, a customer token is never an admin token (and vice versa), tampering/rotation/expiry are rejected, the cookie is httpOnly/Lax/path-wide and Secure only over TLS, `requireCustomer` fails closed, login sets a cookie only on success, signup waits for confirmation when Supabase issued no session, and `GET /orders` returns only the caller's own orders with owner-only tracking secrets |
| `dev/checkPush.mjs` | 21 checks on Web Push: VAPID must be fully configured, a new order fans out to every admin subscription and never to a customer, a confirmation goes only to the owning customer, the tracking secret stays in the URL fragment, a repeated fact sends exactly once, transient failures are recorded and kept while `410`s are cleaned up, no push failure throws, and the subscription endpoint decides the caller's role server-side |
| `dev/checkFooter.mjs` | 9 checks against the **rendered** footer (its Vite SSR bundle, then `react-dom/server`): the Contact Us details, the WhatsApp action and the phone/email tap targets are present, the contact block is not conditional on the viewport and no stylesheet hides it, the sticky "Get Directions" clearance exists at the bar's own breakpoint, long values cannot force a sideways scroll, and the footer still shows every link and line it had before |
| `dev/checkQr.mjs` | Decodes the server-generated UPI QR with **jsQR** — an independent implementation — across every payload length 1..213, several error-correction levels, and realistic `upi://pay` intent strings |

The QR encoder in `api/_lib/qr.js` is hand-written, so it is deliberately checked
against a decoder that is not itself rather than against its own output.

The notification suite stubs `fetch`, not the module that calls it, so the real
Resend transport and the real ledger are exercised and only the network is replaced.
`dev/checkDelivery.mjs` needs no stub at all, because there is nothing left to call:
the rule is a list lookup and a boolean.

Most of `npm test` runs against the in-memory store, because CI has no database.
`dev/checkPostgres.mjs` is the exception: it replaces `pg.Pool` before the store
imports it and reads the SQL the durable driver produces. Without it, the driver
production actually uses would be untested — a delivery area that validates, appears
in the API response and is written by nothing would pass every other suite.

## How ordering works

- **Routes**: `#/cart`, `#/checkout`, `#/order/<orderId>` live in their own hash
  namespace. The existing homepage sections and anchors are untouched.
- **Shared contract**: `shared/ordering.js` and `shared/delivery.js` are imported by
  both the frontend and the API so price calculation, limits, phone validation,
  delivery wording, the area list and the confirmation rule cannot drift.
- **Server-side prices**: the API recomputes every total from `src/data/menu.js`
  and rejects unknown ids or quantities. The localStorage cart is a shopping bag,
  never the database.
- **Idempotency**: every submission carries an `Idempotency-Key`; a double click,
  refresh or retry resolves to the same order. The replay is resolved *before* the
  order is validated and stored, so re-sending a request never creates a second
  order and never invalidates an order already placed.
- **Delivery area**: a published list of areas the customer picks from, plus their
  explicit confirmation of the address. See
  [The delivery rule](#the-delivery-rule).
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
  the delivery area is re-validated against the configured list at order time.
- **Failure is honest**: a failed/cancelled payment lands on an explicit failure
  screen, never a fake success, with Retry and Change-to-COD options that operate
  on the same stored order.

## The delivery rule

JOC no longer measures an address. It publishes a list of areas, the customer picks
one, and they confirm that the address they typed is correct and inside it. This is
worth being precise about, because the rule a customer can argue with should have as
few moving parts as possible.

- **There is no measurement and no third party.** Nothing calls a routing or geocoding
  API, nothing reads a coordinate, and no provider outage can widen or narrow the
  area. `dev/checkDelivery.mjs` fails if any file under `api/`, `shared/` or `src/`
  mentions a maps provider, a radius or a location API, so the old rule cannot creep
  back in through a new import or an inline `fetch`.
- **The list has exactly one home.** `src/data/deliveryAreas.js` holds the areas and
  nothing else defines one. `shared/delivery.js` re-exports it, so the picker and the
  API validation read the same array — an area the customer was offered is always an
  area the server will accept.
- **Membership is checked server-side, on the id only.** `validateDeliveryArea` in
  `shared/delivery.js` normalises case and whitespace and then looks the id up in the
  list. An unknown id is refused; a prototype key such as `constructor` resolves to
  nothing rather than to a truthy object.
- **The label comes from the list, never from the request.** A caller may post
  `deliveryAreaName`, and it is ignored: `deliveryAreaName` on a stored order is
  resolved from the configured list, so a hand-written request cannot make the admin
  dashboard display a name of its choosing.
- **The confirmation must be exactly `true`.** `false`, `"true"`, `1` and `"on"` are
  all refused. The checkbox on the form and the field on the wire have to mean the
  same thing, or one of them can be bypassed.
- **It is enforced in one place.** `shared/ordering.js` calls
  `validateDeliveryArea` inside `validateCheckout`, and `POST /api/orders` builds its
  record from that validated value. There is no preview endpoint to disagree with: the
  checkout preview and the order route are the same code.
- **JOC still reviews it.** Placing an order never resolves delivery. The order
  arrives as `RECEIVED` with the area, the exact address and the customer's
  confirmation attached, and `/admin/orders` shows all three before the existing
  Confirm action. The order is `CANCELLED` if it cannot be delivered.
- **The area is stored, no measurement is.** `delivery_area` and
  `delivery_area_confirmed` are additive columns (`db/migrations/005`). The
  `delivery_*` distance columns from migration 004 are kept untouched as read-only
  history rather than dropped, so orders accepted under the old rule stay readable.
- **The cost is not affected.** `DELIVERY_CHARGE` stays 0 and the UI says "To be
  confirmed" — the area is being restricted, not the price being raised.
- **An order request now touches nothing but the database** (and email, if
  configured). `vercel.json` still allows `maxDuration: 30` for `api/**`, but that
  ceiling was sized for the three sequential routing calls this rule used to make;
  it is now only a backstop on a slow database or mail provider.

### API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/orders` | Create a COD or UPI order (area and address confirmation validated server-side) |
| GET | `/api/orders/:orderId` | Look up an order (token required) |
| POST | `/api/orders/utr` | Submit a UTR (token required) — can only reach `PAYMENT_VERIFICATION_REQUIRED` |
| GET | `/api/payments/methods` | What this deployment can actually offer |
| POST | `/api/payments/create` | Start a gateway session for an order |
| POST | `/api/payments/verify` | Server-verified payment success |
| POST | `/api/payments/cancel` | Mark failed/cancelled, or convert to COD |
| POST | `/api/admin/login` / `/api/admin/session` | Supabase sign-in and session probe for `/admin` |
| GET | `/api/admin/orders` | Admin order list, filters, counts, pagination |
| GET/PATCH | `/api/admin/orders/:orderId` | Order detail, verify a UTR, advance order status, notification audit rows |
| POST | `/api/customer/signup` · `/login` · `/forgot` · `/reset` | Create an account, sign in, request a reset, set a new password — all through Supabase Auth; JOC never stores a password or a hash |
| GET | `/api/customer/session` · `/api/customer/orders` | Session probe, and the signed-in customer's own orders. Ownership comes from the session cookie, never from a query parameter |
| POST/DELETE | `/api/customer/logout` | Clear the customer session cookie |
| GET/POST/DELETE | `/api/push/subscribe` | Web Push: the VAPID public key and the caller's role, subscribe with a browser subscription, unsubscribe by endpoint. The role and user id are derived server-side |

Vercel's Hobby plan allows 12 serverless functions per deployment, so
`/api/payments/methods` is served by `api/payments/create.js` and keeps the URL above:
`vercel.json` rewrites the alias onto the file that also serves the POST route, and
the handler tells the two requests apart by path. The answer is unchanged — the alias
is still a public read with no token, and the POST routes still require the order's
own `X-Order-Token`.

Removing `/api/delivery/*` frees two of those twelve slots, which matters: every
serverless function counts against the plan limit regardless of how small it is.
Customer accounts and push each add exactly one function — `api/customer/[action].js`
(a single-segment dynamic route that dispatches `signup` / `login` / `logout` /
`session` / `forgot` / `reset` / `orders`) and `api/push/subscribe.js` — which keeps
the deployment inside the Hobby cap instead of adding one function per action.

Admin routes require a valid session cookie and fail closed with a 500-style
`ApiError` when `JOC_ADMIN_SESSION_SECRET` is unset. Customer routes are separate:
they use a different cookie signed with a different derived key, and
`POST /api/orders` returns `401 customer_unauthenticated` without one, so an
anonymous browser cannot place an order. `/admin` and `/my-orders` are real paths,
not hash routes, and `vercel.json` sends `X-Robots-Tag: noindex` on both.

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
- **No automated WhatsApp messages.** JOC sends nothing over WhatsApp by itself.
  Separately, the site's footer offers a `wa.me` link and the admin drawer offers a
  "Share on WhatsApp" link, both opened by a person; the admin one is built from
   `JOC_WHATSAPP_NUMBER` and is hidden when that is unset. A real integration would
   need an official JOC business number and a provider implementation.

## Customer accounts

Signup, login and password reset are handled by **Supabase Auth**, the same project
that already guards `/admin`. JOC stores no password and no hash: the browser posts
email + password to `/api/customer/*`, the server exchanges it with Supabase over
TLS, and only a signed `joc_customer_session` cookie comes back. Customer and admin
sessions are signed with **different derived keys**, so a customer cookie can never
be replayed as an admin one (and vice versa).

- **Orders require login.** `POST /api/orders` calls `requireCustomer` first and
  returns `401 customer_unauthenticated` without a valid session. The checkout keeps
  the cart in `localStorage` and reopens at `/#/checkout` after login, so the
  redirect never loses the order the customer was building.
- **Ownership is server-side.** `GET /api/customer/orders` reads the user id from the
  validated session; no `customer_user_id` is ever accepted from the browser.
  "My Orders" lists newest first and its "View Order" reuses the existing
  token-scoped tracking route.
- **The reset link arrives as a fragment.** Supabase's recovery flow lands on
  `/reset-password` with `#access_token=...&type=recovery`; the page reads it from
  the fragment (which is never sent to a server), then calls `/api/customer/reset`.
- **Production gotcha.** Add the site's `/login` and `/reset-password` URLs to
  **Authentication → URL Configuration → Redirect URLs** in Supabase, or the
  confirmation and recovery emails will point at the wrong place.

### Web Push

Real browser push (Push API + a service worker at `public/sw.js` + VAPID), with the
existing polling, badge and sound left in place as the fallback.

- **Two moments notify.** Placing an order pushes a minimal "New JOC Order" fact to
  every authorized **admin** subscription; moving an order to `CONFIRMED` pushes
  "JOC Order Confirmed" **only to the owning customer**. Nothing is broadcast.
- **A push cannot fail an order.** Sends run after the order commits; a push error is
  logged server-side and never surfaces as "Order failed".
- **Exactly once.** `joc_push_deliveries` is unique on
  `(order_uuid, event, subscription_id)`, so a repeated trigger or two dashboard
  clicks cannot send twice. `410 Gone` subscriptions are deleted; transient failures
  are recorded and left retryable.
- **The role is not client-supplied.** `POST /api/push/subscribe` derives the user id
  and the `customer` / `admin` role from the session, then upserts on the unique
  endpoint. Disabling notifications in the UI deletes that endpoint.
- **Honest limits.** Push is best-effort: it needs permission, can be blocked at the
  OS or browser level, and depends on the device being online and the browser alive.
  Where it does not arrive, the dashboard's polling, badge and sound are the
  backstop.

## Environment

Copy `.env.example` → `.env.local` for local development. All values are
**server-side**; there is deliberately no `VITE_` key.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | For durable orders | Supabase Postgres (use the transaction pooler for Vercel) |
| `JOC_AUTO_MIGRATE` | Optional | `true` lets the API run the schema + migrations on first request; set `false` if you provision it yourself |
| `JOC_ALLOW_MEMORY_STORE` | Optional | Only needed to force in-memory mode on a production build |
| `JOC_SITE_URL` | Optional | Base URL for emailed tracking links. Defaults to the production URL |
| `JOC_PAYMENT_PROVIDER` | Optional | `manual_upi` (default) or `razorpay`. Selects which rail settles a digital payment |
| `JOC_UPI_ID` | **For the UPI option at checkout** | The JOC UPI handle. **Not a secret** — it is shown to customers and embedded in the payment QR. Without it, checkout offers Cash on Delivery only |
| `JOC_ADMIN_SESSION_SECRET` | For `/admin` | ≥32 chars, random. Signs the admin session cookie. Never commit |
| `JOC_CUSTOMER_SESSION_SECRET` | Optional | ≥32 chars, random. Signs the customer session cookie; falls back to `JOC_ADMIN_SESSION_SECRET` when unset. A separate value is recommended |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | For `/admin` and customer accounts | Supabase Auth only. The anon key cannot read any table (RLS is enabled with no policies) |
| `JOC_ADMIN_EMAILS` | Optional | Allow-list. Empty means any user who can sign in |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | For Web Push | Generate once with `npx web-push generate-vapid-keys`. The public key is served to the browser; the private key is server-only and a secret; the subject is a `mailto:` or `https:` URL |
| `JOC_NOTIFY_EMAIL` / `JOC_NOTIFY_FROM` / `RESEND_API_KEY` | Optional | Email notifications. All three needed; the key is a secret |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Only if provider is `razorpay` | `rzp_test_...` / `rzp_live_...`. The secret must never be committed |
| `RAZORPAY_TEST_MODE` | Optional | Defaults `true`; live money only when explicitly `false` AND live keys are set |

> **No order is accepted at all?** With no maps provider in the path, the delivery
> rule cannot be the cause. A refused `POST /api/orders` returns a `422` whose
> `error.code` is `invalid_checkout` and whose `error.errors` names the offending
> field — `deliveryArea` or `deliveryAreaConfirmed` for a delivery problem. If
> `deliveryArea` reads "not in JOC's delivery list", the customer picked an area the
> server does not serve, which means `src/data/deliveryAreas.js` and the deployed
> frontend are out of step.

> **Checkout shows Cash on Delivery only?** Check `JOC_UPI_ID` first. It is the
> single variable that decides whether the UPI option appears, and the checkout
> says "Online payment is unavailable right now" whenever it is missing or
> malformed. `GET /api/payments/methods` reports exactly what the server offers,
> which is the fastest way to confirm a deployment's configuration.

### What is and is not a secret

Only these are secret: `DATABASE_URL` (it embeds the DB password),
`JOC_ADMIN_SESSION_SECRET`, `JOC_CUSTOMER_SESSION_SECRET` (if set — otherwise it
inherits the admin secret), `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, and
`RAZORPAY_KEY_SECRET` — the last only if you ever enable Razorpay. Commit none of
them.

`JOC_UPI_ID`, `SUPABASE_ANON_KEY` and `VAPID_PUBLIC_KEY` look sensitive but are
not: `JOC_UPI_ID` is printed on the checkout page and embedded in the payment QR by
design, `VAPID_PUBLIC_KEY` is handed to the browser by `/api/push/subscribe` so it
can create a subscription, and the Supabase anon key only allows exchanging a
password for a session, with RLS enabled and no policies so it cannot read a single
row.

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
2. **Delivery area**: edit `src/data/deliveryAreas.js` with the areas JOC actually
   serves. Nothing to configure and no key to obtain — place one order as a customer,
   then read it at `/admin/orders` to confirm the area, the exact address and the
   customer's acknowledgement all arrive, and confirm the order is `RECEIVED` until
   you accept it.
3. **Payments**: set `JOC_PAYMENT_PROVIDER=manual_upi` and `JOC_UPI_ID` to your
   `handle@bank`. Customers pay that ID, submit the UTR, and an admin verifies it
   at `/admin/orders`. Razorpay stays behind the same provider abstraction: switch
   `JOC_PAYMENT_PROVIDER` to `razorpay` and add the key pair to use it instead.
4. **Admin**: set `JOC_ADMIN_SESSION_SECRET`, `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, then sign in at `/admin`. The dashboard is where a UPI
   payment moves from `PAYMENT_VERIFICATION_REQUIRED` to `PAID`.
5. **Customer accounts**: reuse the same `SUPABASE_URL` and `SUPABASE_ANON_KEY`,
   optionally set `JOC_CUSTOMER_SESSION_SECRET`, and add the site's `/login` and
   `/reset-password` URLs to Supabase's Redirect URLs. Customers sign up at
   `/signup`, sign in at `/login`, and see their orders at `/my-orders`.
   `POST /api/orders` now refuses an anonymous browser.
6. **Web Push (optional)**: run `npx web-push generate-vapid-keys`, set all three
   `VAPID_*` variables, then enable notifications from `/my-orders` (customer) and
   the admin dashboard (admin). Without them push stays off and the polling,
   badge and sound fallback keeps working.
7. **Notifications (optional)**: set `RESEND_API_KEY`, a Resend-verified
   `JOC_NOTIFY_FROM`, and `JOC_NOTIFY_EMAIL` for the admin alert. Customer
   confirmations go to whatever address the customer typed at checkout. Unset,
   everything else keeps working and the ledger records the skips.
8. **Vercel**: connect the repo, add the environment variables for Preview and
   Production, and set the build command/root from `vercel.json`. The API
   functions deploy as serverless routes automatically.

## Project layout

```
api/            Vercel serverless functions (orders, payments)
api/_lib/       Shared server code: store, schema, payments, QR, admin auth,
                customer auth, email, notifications, push
api/admin/      Admin-only routes (login, session, order list/detail)
api/customer/   Customer account route ([action]: signup/login/logout/session/
                forgot/reset/orders)
api/push/       Web Push subscription route
public/sw.js    Service worker: receives push, opens the right same-origin page
db/schema.sql   Postgres schema (orders, notifications, indexes, updated trigger)
db/migrations/  Ordered migrations for an existing database (002 payment/admin,
                003 COD, 004 delivery + email + notifications,
                005 delivery area + confirmation,
                006 customer accounts + push subscriptions/deliveries)
shared/         Contract imported by frontend and API (ordering, delivery)
src/account/    Signup/login/reset, auth context, My Orders, push toggle
src/admin/      Admin dashboard (lazy-loaded; never requested by a customer)
src/cart/       Cart context, localStorage persistence
src/data/       Content: menu, gallery, categories, business details, delivery areas
src/lib/        Hash routing, API client, Razorpay loader, order flow state machine, push client
src/components/cart/    Cart page
src/components/order/   Checkout, area picker, confirmation/tracking/failure
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
| **The areas JOC delivers to** | `src/data/deliveryAreas.js` — the only place an area is defined |
| **Area labels, the confirmation wording and the pending note** | `shared/delivery.js` |
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
categories, currently listed items and prices, and the map location link.

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
2. **Confirm the area list in `src/data/deliveryAreas.js` with JOC.** This is the
   only thing that decides where JOC delivers, and it is a business decision, not a
   technical one. An area that is missing costs a customer; an area that is listed
   but not really served costs a wasted trip. Then apply
   `db/migrations/005_delivery_area_confirmation.sql` before deploying the code that
   writes those columns — Supabase SQL editor (or a direct connection), not the
   transaction pooler, which will not run a multi-statement migration file.
   Production should have `JOC_AUTO_MIGRATE=false`.
3. Confirm the **production order-handling process** (who receives orders, and how).
4. Replace the illustrations with real photography.
5. Replace the temporary wordmark with the official logo.
6. Swap the developer's contact details for the business's own, in
   `src/data/business.js`.
7. Create the production Supabase project and add `DATABASE_URL`.
8. Apply `db/migrations/006_customer_accounts.sql` before deploying this code (the
   same SQL-editor/direct-connection rule as 005), set
   `JOC_CUSTOMER_SESSION_SECRET`, and add `/login` and `/reset-password` to
   Supabase's Redirect URLs. Place a test order while signed out to confirm
   `POST /api/orders` returns `401 customer_unauthenticated`, then sign in and
   confirm it succeeds.
9. (Optional) Run `npx web-push generate-vapid-keys`, set the three `VAPID_*`
   variables, and enable notifications at `/my-orders` and in the dashboard.
10. Confirm `JOC_UPI_ID` on the production deployment by reading
    `GET /api/payments/methods` — it should report `provider: manual_upi` with
    both Cash on Delivery and UPI available.
11. Place one test order from a real customer address and read it at
    `/admin/orders`: the area, the exact address and the customer's confirmation
    should all be there, and the order should sit at `RECEIVED` until you accept it.
    This is the one flow where "it looks fine in the browser" is not evidence — the
    confirmation the customer ticked is not the same as the address JOC can find.
12. Set `JOC_SITE_URL` to the real domain, so tracking links in customer emails
    point at production.
13. Run `npm test` and `npm run lint` against the final state.
14. Add the live domain as `<link rel="canonical">` and a real 1200×630 OG image.
15. Remove the concept/demo wording from the hero, contact section and footer.
16. Decide the order-status workflow (`RECEIVED → … → DELIVERED` is already
    modelled and enforced server-side, and editable from `/admin/orders`).

> Razorpay is **not** required to go live. It stays behind the provider
> abstraction; only set `JOC_PAYMENT_PROVIDER=razorpay`, add the key pair and set
> `RAZORPAY_TEST_MODE=false` if you later decide to use it instead. Run a real ₹2
> test payment first.