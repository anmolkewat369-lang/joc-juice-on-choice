/**
 * Web Push checks.
 *
 * The transport is stubbed at the `web-push` object itself, so the real
 * recipient rules, the real exactly-once ledger and the real payload composer
 * run without contacting a push service. What is pinned here:
 *
 *   * a customer is only ever pushed their OWN order, and an admin only new
 *     orders — role and id are read from the store, never from the payload;
 *   * the same fact never produces two pushes;
 *   * a dead push service cannot fail an order, and a permanently-gone
 *     subscription is cleaned up instead of retried forever;
 *   * nothing secret (the VAPID private key, DB credentials) rides along.
 */

import assert from "node:assert/strict";
import webpush from "web-push";

import {
  isPushConfigured,
  pushPublicKey,
  notifyAdminNewOrderPush,
  notifyCustomerOrderConfirmedPush,
} from "../api/_lib/push.js";
import { getStore, _resetStoreCache } from "../api/_lib/store.js";
import { createCustomerSession } from "../api/_lib/customerAuth.js";
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from "../shared/ordering.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;

const PUBLIC_KEY = "test-vapid-public-key";
const PRIVATE_KEY = "test-vapid-private-key-do-not-log";
const SUBJECT = "mailto:ops@joc.test";

const setVapid = ({ publicKey = PUBLIC_KEY, privateKey = PRIVATE_KEY, subject = SUBJECT } = {}) => {
  if (publicKey === null) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = publicKey;
  if (privateKey === null) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = privateKey;
  if (subject === null) delete process.env.VAPID_SUBJECT;
  else process.env.VAPID_SUBJECT = subject;
};

setVapid();

/* ------------------------------- push stub --------------------------------- */

const sends = [];
let sendBehavior = null;

webpush.setVapidDetails = () => {};
webpush.sendNotification = async (subscription, payload, options) => {
  sends.push({ subscription, payload: JSON.parse(payload), options });
  if (sendBehavior) return sendBehavior(subscription, sends.length);
  return { statusCode: 201 };
};

/** A send that fails. 404/410 mean the subscription is permanently gone. */
const failWith = (statusCode) => () => {
  const error = new Error(`push service ${statusCode}`);
  error.statusCode = statusCode;
  throw error;
};

/* ------------------------------ handler harness ----------------------------- */

const callRoute = async (modulePath, { method = "GET", headers = {}, body = {} } = {}) => {
  const { default: handler } = await import(modulePath);
  const req = {
    method,
    headers: { "content-type": "application/json", ...headers },
    query: {},
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

/* --------------------------------- fixtures -------------------------------- */

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

let orderSequence = 0;

const baseRecord = () => ({
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
});

const makeOrder = async (over = {}) => {
  const store = await getStore();
  orderSequence += 1;
  const { order } = await store.createOrder(
    { ...baseRecord(), ...over },
    `push-check-${orderSequence}`,
  );
  return { store, order };
};

const subscribe = (store, { role = "customer", userId = "cust-a", endpoint, p256dh = "p", auth = "a" } = {}) =>
  store.upsertPushSubscription({ userId, role, endpoint, p256dh, auth });

/* ---------------------------------- config --------------------------------- */

check("push is off, and the public key absent, without VAPID keys", () => {
  setVapid({ publicKey: null, privateKey: null });
  try {
    assert.equal(isPushConfigured(), false);
    assert.equal(pushPublicKey(), null, "the browser must never be handed a key when push is off");
  } finally {
    setVapid();
  }
});

check("push is on, and the public key published, with a full configuration", () => {
  assert.equal(isPushConfigured(), true);
  assert.equal(pushPublicKey(), PUBLIC_KEY);
});

check("a subject that is not mailto:/https: keeps push off", () => {
  setVapid({ subject: "http://not-allowed.example" });
  try {
    assert.equal(isPushConfigured(), false);
  } finally {
    setVapid();
  }
});

check("a half-configured VAPID pair keeps push off rather than sending unsigned", () => {
  setVapid({ privateKey: null });
  try {
    assert.equal(isPushConfigured(), false);
  } finally {
    setVapid();
  }
});

/* ------------------------------ recipient rules ----------------------------- */

check("a new order with no admin subscriptions pushes nobody", async () => {
  const { store, order } = await makeOrder();
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });

  const result = await notifyAdminNewOrderPush(store, order);
  assert.equal(sends.length, 0);
  assert.equal(result.reason, "no_subscriptions");
});

check("a new order fans out to every admin subscription", async () => {
  const { store, order } = await makeOrder({ customerName: "Asha Rao" });
  await subscribe(store, { role: "admin", userId: "admin-1", endpoint: "https://push.test/a1" });
  await subscribe(store, { role: "admin", userId: "admin-2", endpoint: "https://push.test/a2" });

  const result = await notifyAdminNewOrderPush(store, order);
  assert.equal(result.sent, 2, "both signed-in operators hear about the order");

  for (const send of sends) {
    assert.equal(send.payload.title, "New JOC Order");
    assert.equal(send.payload.url, "/admin/orders", "the admin taps through to the dashboard");
    assert.match(send.payload.body, new RegExp(order.order_id));
    assert.match(send.payload.body, /₹318/);
  }
});

check("an admin fan-out never reaches a customer subscription", async () => {
  const { store, order } = await makeOrder();
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  await subscribe(store, { role: "admin", userId: "admin-1", endpoint: "https://push.test/a1" });

  const result = await notifyAdminNewOrderPush(store, order);
  assert.equal(result.sent, 1);
  assert.equal(sends[0].subscription.endpoint, "https://push.test/a1");
});

check("a confirmation goes only to the owning customer's subscriptions", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  await subscribe(store, { role: "customer", userId: "cust-b", endpoint: "https://push.test/c2" });

  const result = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(result.sent, 1, "a customer must never receive another customer's order");
  assert.equal(sends[0].subscription.endpoint, "https://push.test/c1");
});

check("a confirmation for a customer with no subscription pushes nobody", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-b", endpoint: "https://push.test/c2" });

  const result = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(sends.length, 0);
  assert.equal(result.reason, "no_subscriptions");
});

check("an anonymous or legacy order has no customer to notify", async () => {
  const { store, order } = await makeOrder();
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });

  const result = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(sends.length, 0);
  assert.equal(result.reason, "no_recipient");
});

/* -------------------------------- payloads --------------------------------- */

check("the customer link keeps the tracking token in the fragment, not the query", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "secret-token" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });

  await notifyCustomerOrderConfirmedPush(store, order);
  const { payload } = sends[0];
  assert.equal(payload.title, "JOC Order Confirmed");
  assert.match(payload.url, /^\/#\/order\//, "the link opens the existing tracking page");
  assert.ok(
    payload.url.indexOf("t=secret-token") > payload.url.indexOf("#"),
    "the secret must sit after the #, where no server sees it",
  );
  assert.equal(
    JSON.stringify(payload.data).includes("secret-token"),
    false,
    "the structured data must not duplicate the secret",
  );
});

check("the push payload carries no server secret", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "secret-token" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });

  await notifyCustomerOrderConfirmedPush(store, order);
  const serialised = JSON.stringify(sends[0].payload);
  assert.equal(serialised.includes(PRIVATE_KEY), false, "the VAPID private key must never be sent");
  for (const name of ["DATABASE_URL", "SUPABASE_ANON_KEY", "JOC_ADMIN_SESSION_SECRET"]) {
    const value = process.env[name];
    if (value && value.length >= 8) {
      assert.equal(serialised.includes(value), false, `${name} leaked into a push payload`);
    }
  }
});

/* ------------------------------- exactly once ------------------------------ */

check("a repeated confirmation sends exactly one push", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });

  await notifyCustomerOrderConfirmedPush(store, order);
  await notifyCustomerOrderConfirmedPush(store, order);
  await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(sends.length, 1, "the ledger, not the caller's discipline, prevents duplicates");
});

check("each subscription gets one push per fact, however often it is triggered", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c2" });

  await notifyCustomerOrderConfirmedPush(store, order);
  await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(sends.length, 2, "one per device, and no more after a repeat");
  assert.deepEqual(
    sends.map((send) => send.subscription.endpoint).sort(),
    ["https://push.test/c1", "https://push.test/c2"],
  );
});

/* ------------------------------ failure handling ---------------------------- */

check("a transient push failure is recorded, kept, and never thrown", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  sendBehavior = failWith(500);

  const result = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1, "the failure must be counted, not swallowed silently");

  const rows = await store.listPushSubscriptions({ role: "customer", userId: "cust-a" });
  assert.equal(rows.length, 1, "a transient failure must not delete the subscription");

  // A failed delivery is retryable: the next attempt is allowed through.
  sendBehavior = null;
  await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(sends.length, 2, "the retry after a failure is a new attempt");
});

check("a 410 gone subscription is deleted rather than retried forever", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/gone" });
  sendBehavior = failWith(410);

  const result = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(result.failed, 1);

  const rows = await store.listPushSubscriptions({ role: "customer", userId: "cust-a" });
  assert.equal(rows.length, 0, "an expired subscription must be cleaned up");

  sendBehavior = null;
  const again = await notifyCustomerOrderConfirmedPush(store, order);
  assert.equal(again.reason, "no_subscriptions");
  assert.equal(sends.length, 1, "nothing more is sent once the subscription is gone");
});

check("with push unconfigured the helpers skip without sending", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  setVapid({ publicKey: null, privateKey: null });
  try {
    const admin = await notifyAdminNewOrderPush(store, order);
    const customer = await notifyCustomerOrderConfirmedPush(store, order);
    assert.equal(admin.reason, "not_configured");
    assert.equal(customer.reason, "not_configured");
    assert.equal(sends.length, 0);
  } finally {
    setVapid();
  }
});

check("a broken delivery ledger cannot make the push helper throw", async () => {
  const { store, order } = await makeOrder({ customerUserId: "cust-a", trackingToken: "sec-a" });
  await subscribe(store, { role: "customer", userId: "cust-a", endpoint: "https://push.test/c1" });
  const broken = {
    ...store,
    claimPushDelivery: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  };

  const result = await notifyCustomerOrderConfirmedPush(broken, order);
  assert.ok(result, "the caller gets a result object, never an exception");
  assert.equal(result.sent, 0);
});

/* --------------------------- subscription endpoint -------------------------- */

check("the subscription endpoint refuses an anonymous caller", async () => {
  const get = await callRoute("../api/push/subscribe.js", { method: "GET" });
  assert.equal(get.statusCode, 401, "an anonymous browser must not subscribe itself");

  const post = await callRoute("../api/push/subscribe.js", {
    method: "POST",
    body: { endpoint: "https://push.test/x", keys: { p256dh: "p", auth: "a" } },
  });
  assert.equal(post.statusCode, 401);
});

check("a signed-in customer is told their own role and the public key", async () => {
  process.env.JOC_CUSTOMER_SESSION_SECRET = "a-customer-test-secret-that-is-long-enough-xxxx";
  const token = createCustomerSession({ id: "cust-a", email: "a@b.test" }).token;
  const res = await callRoute("../api/push/subscribe.js", {
    method: "GET",
    headers: { cookie: `joc_customer_session=${token}` },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.role, "customer", "the role is decided by the server");
  assert.equal(res.payload.publicKey, PUBLIC_KEY);
});

check("a subscription with an invalid endpoint is refused", async () => {
  process.env.JOC_CUSTOMER_SESSION_SECRET = "a-customer-test-secret-that-is-long-enough-xxxx";
  const token = createCustomerSession({ id: "cust-a", email: "a@b.test" }).token;
  for (const endpoint of ["http://insecure.test/x", "not-a-url", `https://push.test/${"x".repeat(5000)}`]) {
    const res = await callRoute("../api/push/subscribe.js", {
      method: "POST",
      headers: { cookie: `joc_customer_session=${token}` },
      body: { endpoint, keys: { p256dh: "p", auth: "a" } },
    });
    assert.equal(res.statusCode, 422, `"${endpoint.slice(0, 20)}" must be refused`);
    assert.equal(res.payload.error.code, "invalid_subscription");
  }
});

/* ----------------------------------- run ----------------------------------- */

let failed = 0;
for (const [name, fn] of checks) {
  sends.length = 0;
  sendBehavior = null;
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

console.log(`\n${checks.length - failed}/${checks.length} web-push checks passed`);
process.exit(failed === 0 ? 0 : 1);
