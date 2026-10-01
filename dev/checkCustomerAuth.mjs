/**
 * Customer-account checks.
 *
 * These pin down the two things that make customer login safe, without touching a
 * real Supabase project:
 *
 *   1. SEPARATION. A customer session is signed with its own derived key and
 *      carries a `typ` we control, so a customer token can never be replayed as
 *      an admin token (or vice versa). Fail-closed: no secret, no session.
 *   2. OWNERSHIP. The order list is scoped by the id inside the signed cookie,
 *      never by anything the browser sends. Two customers, two cookies, two
 *      disjoint lists.
 *
 * The GoTrue transport is stubbed at `fetch`, so the real handler, the real
 * cookie code and the real session signing are all exercised against a Supabase
 * that answers exactly what each check needs.
 */

import assert from "node:assert/strict";

import {
  SESSION_COOKIE,
  createCustomerSession,
  verifyCustomerSession,
  setCustomerSessionCookie,
  readCustomerSessionCookie,
  customerFrom,
  requireCustomer,
} from "../api/_lib/customerAuth.js";
import { createSessionToken, verifySessionToken } from "../api/_lib/adminAuth.js";
import { getStore, _resetStoreCache } from "../api/_lib/store.js";
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from "../shared/ordering.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;

const CUSTOMER_SECRET = "a-customer-test-secret-that-is-long-enough-xxxx";
const ADMIN_SECRET = "an-admin-test-secret-that-is-long-enough-xxxxx";

process.env.JOC_CUSTOMER_SESSION_SECRET = CUSTOMER_SECRET;
process.env.JOC_ADMIN_SESSION_SECRET = ADMIN_SECRET;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_ANON_KEY = "anon-key-for-tests";

/* ------------------------------- supabase stub ------------------------------ */

/** A per-check reply for any `/auth/v1/...` call. */
let supaReply = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  if (!url.includes("/auth/v1/")) return realFetch(input, init);
  if (!supaReply) throw new Error(`unexpected Supabase call: ${url}`);
  return supaReply(url, init);
};

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const withSupabase = (reply, fn) => async () => {
  const before = supaReply;
  supaReply = reply;
  try {
    return await fn();
  } finally {
    supaReply = before;
  }
};

/* ------------------------------ handler harness ----------------------------- */

const callCustomer = async (action, { method = "GET", headers = {}, body = {} } = {}) => {
  const { default: handler } = await import("../api/customer/[action].js");
  const req = {
    method,
    headers: { "content-type": "application/json", ...headers },
    query: { action },
    body: JSON.stringify(body),
    on: () => {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  return res;
};

const cookieFrom = (res) => res.headers["Set-Cookie"] ?? res.headers["set-cookie"] ?? null;

const cookieHeader = (customer) => `${SESSION_COOKIE}=${createCustomerSession(customer).token}`;

/* --------------------------------- fixtures -------------------------------- */

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const baseRecord = (over = {}) => ({
  customerName: "Asha Rao",
  phone: "9876543210",
  customerEmail: "asha@example.com",
  deliveryArea: "dixit-colony",
  deliveryAreaConfirmed: true,
  address: "Plot 42, Dixit Colony, Jabalpur 482002",
  items: [{ id: "paneer-momos", name: "Paneer Momos", qty: 2, lineTotal: 318 }],
  subtotal: 318,
  deliveryCharge: 0,
  total: 318,
  currency: "INR",
  paymentMethod: PAYMENT_METHOD.COD,
  paymentStatus: PAYMENT_STATUS.PENDING,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentProvider: "cod",
  ...over,
});

/* ------------------------------ session signing ----------------------------- */

check("a session cannot be minted without a configured secret", () => {
  const saved = process.env.JOC_CUSTOMER_SESSION_SECRET;
  delete process.env.JOC_CUSTOMER_SESSION_SECRET;
  process.env.JOC_ADMIN_SESSION_SECRET = "";
  try {
    assert.throws(
      () => createCustomerSession({ id: "u1", email: "a@b.test" }),
      (error) => error.code === "auth_not_configured",
      "an unconfigured server must refuse rather than sign with a default",
    );
  } finally {
    process.env.JOC_CUSTOMER_SESSION_SECRET = saved;
    process.env.JOC_ADMIN_SESSION_SECRET = ADMIN_SECRET;
  }
});

check("a minted session verifies back to exactly its identity", () => {
  const { token } = createCustomerSession({ id: "uuid-123", email: "Asha@Example.com" });
  const who = verifyCustomerSession(token);
  assert.equal(who.id, "uuid-123");
  assert.equal(who.email, "Asha@Example.com");
});

check("a tampered session token is rejected", () => {
  const { token } = createCustomerSession({ id: "uuid-123", email: "a@b.test" });
  const [body, signature] = token.split(".");
  const flipped = `${body}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifyCustomerSession(flipped), null);
  assert.equal(verifyCustomerSession(`${body}.`), null);
  assert.equal(verifyCustomerSession("not-a-token"), null);
});

check("a session signed with a different secret is rejected", () => {
  const first = createCustomerSession({ id: "uuid-123", email: "a@b.test" }).token;
  process.env.JOC_CUSTOMER_SESSION_SECRET = "a-completely-different-secret-long-enough-x";
  try {
    assert.equal(verifyCustomerSession(first), null, "rotating the secret must end old sessions");
  } finally {
    process.env.JOC_CUSTOMER_SESSION_SECRET = CUSTOMER_SECRET;
  }
});

check("an expired session is rejected even with a valid signature", () => {
  const past = Date.now() - 31 * 24 * 60 * 60 * 1000;
  const { token } = createCustomerSession({ id: "uuid-123", email: "a@b.test" }, { now: past });
  assert.equal(verifyCustomerSession(token), null);
});

check("a customer session is not an admin session", () => {
  const { token } = createCustomerSession({ id: "uuid-123", email: "a@b.test" });
  assert.equal(verifySessionToken(token), null, "domain separation must hold in this direction");
});

check("an admin session is not a customer session", () => {
  const { token } = createSessionToken({ id: "admin-1", email: "ops@joc.test" });
  assert.equal(verifyCustomerSession(token), null, "and in the other direction");
});

/* --------------------------------- cookies --------------------------------- */

check("the cookie is httpOnly and path-wide, and Secure only over TLS", () => {
  const { token, maxAge } = createCustomerSession({ id: "u1", email: "a@b.test" });
  const headerFor = (req) => {
    const res = {
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
    };
    setCustomerSessionCookie(res, req, token, maxAge);
    return res.headers["Set-Cookie"] ?? res.headers["set-cookie"];
  };

  const insecure = headerFor({ headers: {} });
  assert.match(insecure, /HttpOnly/);
  assert.match(insecure, /SameSite=Lax/);
  assert.match(insecure, /Path=\//);
  assert.equal(/Secure/.test(insecure), false, "a plain-http request must not set Secure");

  const secure = headerFor({ headers: { "x-forwarded-proto": "https" } });
  assert.match(secure, /Secure/);
});

check("the cookie is read back from a crowded cookie header", () => {
  const { token } = createCustomerSession({ id: "u1", email: "a@b.test" });
  const req = { headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}; other=1` } };
  assert.equal(readCustomerSessionCookie(req), token);
  assert.equal(readCustomerSessionCookie({ headers: { cookie: "theme=dark" } }), null);
  assert.equal(readCustomerSessionCookie({ headers: {} }), null);
});

check("requireCustomer refuses an anonymous request", () => {
  assert.throws(
    () => requireCustomer({ headers: {} }),
    (error) => error.status === 401 && error.code === "customer_unauthenticated",
  );
  assert.equal(customerFrom({ headers: { cookie: `${SESSION_COOKIE}=junk` } }), null);
});

check("requireCustomer reports an unconfigured server rather than allowing", () => {
  const saved = process.env.JOC_CUSTOMER_SESSION_SECRET;
  delete process.env.JOC_CUSTOMER_SESSION_SECRET;
  process.env.JOC_ADMIN_SESSION_SECRET = "";
  try {
    assert.throws(
      () => requireCustomer({ headers: {} }),
      (error) => error.status === 503,
    );
  } finally {
    process.env.JOC_CUSTOMER_SESSION_SECRET = saved;
    process.env.JOC_ADMIN_SESSION_SECRET = ADMIN_SECRET;
  }
});

/* ---------------------------------- routes --------------------------------- */

check("GET /session says so honestly when the server is unconfigured", async () => {
  const saved = process.env.JOC_CUSTOMER_SESSION_SECRET;
  delete process.env.JOC_CUSTOMER_SESSION_SECRET;
  process.env.JOC_ADMIN_SESSION_SECRET = "";
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    const res = await callCustomer("session");
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.configured, false);
    assert.equal(res.payload.signedIn, false);
  } finally {
    process.env.JOC_CUSTOMER_SESSION_SECRET = saved;
    process.env.JOC_ADMIN_SESSION_SECRET = ADMIN_SECRET;
    process.env.SUPABASE_URL = savedUrl;
  }
});

check(
  "POST /login sets a session cookie on success",
  withSupabase(
    (url) => {
      assert.match(url, /grant_type=password/);
      return jsonResponse(200, {
        access_token: "supa-access",
        user: { id: "uuid-login", email: "asha@example.com" },
      });
    },
    async () => {
      const res = await callCustomer("login", {
        method: "POST",
        body: { email: "Asha@Example.com", password: "hunter2hunter2" },
      });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(res.payload.signedIn, true);
      assert.equal(res.payload.customer.id, "uuid-login");
      const cookie = cookieFrom(res);
      assert.ok(
        cookie && cookie.startsWith(`${SESSION_COOKIE}=`),
        "a session cookie must be issued",
      );
      assert.equal(
        /supa-access/.test(cookie),
        false,
        "the Supabase token must never enter the cookie",
      );
    },
  ),
);

check(
  "POST /login refuses bad credentials without setting a cookie",
  withSupabase(
    () =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      }),
    async () => {
      const res = await callCustomer("login", {
        method: "POST",
        body: { email: "asha@example.com", password: "wrong-password" },
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.payload.error.code, "invalid_credentials");
      assert.equal(cookieFrom(res), null, "no cookie may be issued for a failed login");
    },
  ),
);

check(
  "POST /signup waits for confirmation when Supabase issued no session",
  withSupabase(
    () =>
      jsonResponse(200, {
        user: { id: "uuid-pending", email: "asha@example.com" },
        session: null,
      }),
    async () => {
      const res = await callCustomer("signup", {
        method: "POST",
        body: {
          name: "Asha Rao",
          email: "asha@example.com",
          password: "hunter2hunter2",
          confirmPassword: "hunter2hunter2",
        },
      });
      assert.equal(res.statusCode, 201, JSON.stringify(res.payload));
      assert.equal(res.payload.confirmationRequired, true);
      assert.equal(res.payload.signedIn, false);
      assert.equal(cookieFrom(res), null, "an unconfirmed account must not get a session");
    },
  ),
);

check(
  "POST /signup signs the customer in when Supabase auto-confirms",
  withSupabase(
    () =>
      jsonResponse(200, {
        access_token: "supa-signup-access",
        user: { id: "uuid-new", email: "asha@example.com" },
      }),
    async () => {
      const res = await callCustomer("signup", {
        method: "POST",
        body: {
          name: "Asha Rao",
          email: "asha@example.com",
          password: "hunter2hunter2",
          confirmPassword: "hunter2hunter2",
        },
      });
      assert.equal(res.statusCode, 201, JSON.stringify(res.payload));
      assert.equal(res.payload.signedIn, true);
      assert.equal(res.payload.customer.id, "uuid-new");
      assert.ok(cookieFrom(res), "an auto-confirmed account is signed straight in");
    },
  ),
);

check("GET /orders requires a session", async () => {
  const res = await callCustomer("orders");
  assert.equal(res.statusCode, 401, "the order list must not be readable anonymously");
  assert.equal(res.payload.error.code, "customer_unauthenticated");
});

check("GET /orders returns only the caller's own orders", async () => {
  const store = await getStore();
  await store.createOrder(
    baseRecord({ customerUserId: "cust-a", trackingToken: "token-a" }),
    "cust-auth-order-a",
  );
  await store.createOrder(
    baseRecord({ customerUserId: "cust-b", trackingToken: "token-b" }),
    "cust-auth-order-b",
  );
  await store.createOrder(baseRecord(), "cust-auth-order-anon");

  const res = await callCustomer("orders", {
    headers: { cookie: cookieHeader({ id: "cust-a", email: "a@example.com" }) },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.orders.length, 1, "only one order belongs to cust-a");
  const [order] = res.payload.orders;
  assert.equal(order.trackingToken, "token-a", "the owner gets the secret to open tracking");
  assert.equal(
    JSON.stringify(res.payload).includes("token-b"),
    false,
    "another customer's order and secret must never appear",
  );
});

/* ----------------------------------- run ----------------------------------- */

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    _resetStoreCache();
    console.log(`  pass  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
    _resetStoreCache();
  }
}

console.log(`\n${checks.length - failed}/${checks.length} customer-auth checks passed`);
process.exit(failed === 0 ? 0 : 1);
