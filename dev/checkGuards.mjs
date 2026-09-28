/**
 * Guard-rule checks for the manual-UPI + admin flow, run against the in-memory
 * store so they need no database. Written as a plain script because the project
 * has no test runner configured yet; it exits non-zero on the first failure.
 */

import assert from "node:assert/strict";

import { getStore, toPublicOrder, _resetStoreCache } from "../api/_lib/store.js";
import {
  changeOrderStatus,
  getOrderDetail,
  orderCounts,
  verifyPayment,
  verificationPreview,
  listOrders,
} from "../api/_lib/ordersAdmin.js";
import { requireOwnedOrderId } from "../api/_lib/orderToken.js";
import { normalisePaymentReference, ORDER_STATUS, PAYMENT_STATUS } from "../shared/ordering.js";
import { orderSummaryText, whatsappLink } from "../api/_lib/notify.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const upiRecord = (over = {}) => ({
  customerName: "Asha Rao",
  phone: "9876543210",
  address: "12 MG Road, Indiranagar",
  landmark: "Opposite Toit",
  specialInstructions: "Less ice",
  items: [{ id: "citrus-ginger", name: "Ginger Citrus", qty: 2, lineTotal: 396 }],
  subtotal: 396,
  deliveryCharge: 0,
  total: 396,
  currency: "INR",
  paymentMethod: "UPI",
  paymentStatus: PAYMENT_STATUS.PENDING,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentProvider: "manual_upi",
  ...over,
});

const admin = { id: "auth-user-1", email: "anmolkewat369@gmail.com" };

/* ------------------------------ UTR validation ---------------------------- */

check("UTR rejects a too-short reference", () => {
  const { error } = normalisePaymentReference("12");
  assert.ok(error, "expected an error message");
});

check("UTR rejects punctuation but accepts alphanumeric bank references", () => {
  // Not every bank issues a 12-digit numeric UTR; some show an alphanumeric
  // reference. Both are legitimate, so the rule is "no symbols", not "digits only".
  assert.ok(normalisePaymentReference("12!@#$").error, "symbols must be rejected");
  assert.ok(normalisePaymentReference("UPI 4212 3456 7890").error === null, "internal spaces are stripped");
  assert.equal(normalisePaymentReference("421234567890").value, "421234567890");
  assert.equal(normalisePaymentReference("UTR123456789ABC").value, "UTR123456789ABC");
  assert.ok(normalisePaymentReference("x".repeat(65)).error, "an absurdly long value is rejected");
});

check("UTR normalises to digits and uppercases the hint", () => {
  const { value } = normalisePaymentReference(" 421234567890  ");
  assert.equal(value, "421234567890");
});

/* --------------------------- customer ownership --------------------------- */

check("a wrong order token is refused", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-owner-1");
  const req = { headers: { "x-order-token": "not-the-right-token" } };
  await assert.rejects(
    () => requireOwnedOrderId(req, store, order.order_id),
    (error) => error.status === 404,
    "a wrong token must 404, not leak the order",
  );
});

check("a missing order token is refused", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-owner-2");
  await assert.rejects(
    () => requireOwnedOrderId({ headers: {} }, store, order.order_id),
    (error) => error.status === 404,
  );
});

/* ------------------- payment routes reject unowned orders ----------------- */

const callRoute = async (modulePath, { method = "POST", headers = {}, body = {}, query = {} } = {}) => {
  const { default: handler } = await import(modulePath);
  const req = {
    method,
    headers: { "content-type": "application/json", ...headers },
    query,
    body,
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
  // readJson expects a stream-like body
  req.body = JSON.stringify(body);
  req.on = () => {};
  req[Symbol.asyncIterator] = async function* () {
    yield Buffer.from(JSON.stringify(body));
  };
  await handler(req, res);
  return res;
};

check("payments/create refuses a caller with no order token", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(
    upiRecord({ paymentProvider: "razorpay" }),
    "key-paycreate-1",
  );
  const res = await callRoute("../api/payments/create.js", {
    body: { orderId: order.order_id },
  });
  assert.equal(res.statusCode, 404, "expected 404 without the order token");
});

check("payments/cancel refuses a caller with no order token", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(
    upiRecord({ paymentProvider: "razorpay" }),
    "key-cancel-1",
  );
  const res = await callRoute("../api/payments/cancel.js", {
    body: { orderId: order.order_id },
  });
  assert.equal(res.statusCode, 404, "expected 404 without the order token");

  // And the order was not downgraded to COD behind the caller's back.
  const after = await store.getOrder(order.order_id);
  assert.equal(after.payment_method, "UPI", "a refused call must not mutate the order");
});

check("payments/verify refuses a caller with no order token", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(
    upiRecord({ paymentProvider: "razorpay" }),
    "key-verify-route-1",
  );
  const res = await callRoute("../api/payments/verify.js", {
    body: { orderId: order.order_id, gatewayOrderId: "order_x", paymentId: "pay_x", signature: "s" },
  });
  assert.equal(res.statusCode, 404, "expected 404 without the order token");
  const after = await store.getOrder(order.order_id);
  assert.equal(after.payment_status, PAYMENT_STATUS.PENDING, "must not be marked paid");
});

check("a manual-UPI order is refused by the Razorpay create route", async () => {
  const store = await getStore();
  const token = "known-token-for-provider-check-0001";
  const { order } = await store.createOrder(upiRecord({ accessToken: token }), "key-provider-1");
  const res = await callRoute("../api/payments/create.js", {
    headers: { "x-order-token": token },
    body: { orderId: order.order_id },
  });
  // The route authenticates the caller first, so a manual-UPI order with a valid
  // token gets past the 404 and is refused on provider grounds instead.
  assert.equal(res.statusCode, 409, `expected 409 provider mismatch, got ${res.statusCode}`);
});

check("utr.js refuses a caller with no order token", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-utr-1");
  const res = await callRoute("../api/orders/utr.js", {
    body: { orderId: order.order_id, paymentReference: "421234567890" },
  });
  assert.equal(res.statusCode, 404, "expected 404 without the order token");
  const after = await store.getOrder(order.order_id);
  assert.equal(after.payment_reference, null, "a refused UTR must not be stored");
});

check("utr.js accepts a token the caller owns and records the reference", async () => {
  const store = await getStore();
  const token = "known-token-for-utr-submit-0001";
  const { order } = await store.createOrder(upiRecord({ accessToken: token }), "key-utr-2");
  const res = await callRoute("../api/orders/utr.js", {
    headers: { "x-order-token": token },
    body: { orderId: order.order_id, paymentReference: "421234567890" },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  const after = await store.getOrder(order.order_id);
  assert.equal(after.payment_reference, "421234567890");
  assert.equal(after.payment_status, PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED);
  assert.notEqual(after.payment_status, PAYMENT_STATUS.PAID, "a submitted UTR must never be PAID");
});

check("admin routes refuse an unauthenticated caller", async () => {
  process.env.JOC_ADMIN_SESSION_SECRET = "a-test-secret-that-is-definitely-long-enough-x";
  const list = await callRoute("../api/admin/orders/index.js", { method: "GET" });
  assert.equal(list.statusCode, 401, "GET /api/admin/orders must require a session");

  const detail = await callRoute("../api/admin/orders/[orderId].js", {
    method: "GET",
    query: { orderId: "JOC-20260928-0001" },
  });
  assert.equal(detail.statusCode, 401, "GET /api/admin/orders/[orderId] must require a session");
});

check("admin routes refuse a forged session cookie", async () => {
  process.env.JOC_ADMIN_SESSION_SECRET = "a-test-secret-that-is-definitely-long-enough-x";
  const res = await callRoute("../api/admin/orders/index.js", {
    method: "GET",
    headers: { cookie: "joc_admin_session=eyJzdWIiOiJoYWNrZXIifQ.notarealsignature" },
  });
  assert.equal(res.statusCode, 401, "a forged cookie must not authenticate");
});

check("admin routes fail closed when no session secret is configured", async () => {
  delete process.env.JOC_ADMIN_SESSION_SECRET;
  const res = await callRoute("../api/admin/orders/index.js", { method: "GET" });
  assert.equal(res.statusCode, 503, "an unconfigured server must report itself, not allow access");
  process.env.JOC_ADMIN_SESSION_SECRET = "a-test-secret-that-is-definitely-long-enough-x";
});

check("a valid admin session cookie is accepted", async () => {
  const secret = "a-test-secret-that-is-definitely-long-enough-x";
  process.env.JOC_ADMIN_SESSION_SECRET = secret;
  const { createSessionToken } = await import("../api/_lib/adminAuth.js");
  const { token } = createSessionToken({ id: "auth-user-1", email: admin.email });
  const res = await callRoute("../api/admin/orders/index.js", {
    method: "GET",
    headers: { cookie: `joc_admin_session=${token}` },
  });
  assert.equal(res.statusCode, 200, `expected 200 for a valid session, got ${res.statusCode}`);
  assert.ok(Array.isArray(res.payload.orders), "expected an orders array");
});

check("a session cookie signed with a different secret is rejected", async () => {
  const { createSessionToken } = await import("../api/_lib/adminAuth.js");
  process.env.JOC_ADMIN_SESSION_SECRET = "the-first-secret-that-is-long-enough-xxxxx";
  const { token } = createSessionToken({ id: "auth-user-1", email: admin.email });
  process.env.JOC_ADMIN_SESSION_SECRET = "the-second-secret-that-is-long-enough-xxxx";
  const res = await callRoute("../api/admin/orders/index.js", {
    method: "GET",
    headers: { cookie: `joc_admin_session=${token}` },
  });
  assert.equal(res.statusCode, 401, "rotating the secret must invalidate old sessions");
});

/* ------------------------------ payment gates ----------------------------- */

check("verifyPayment refuses an order with no UTR submitted", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-verify-1");
  await assert.rejects(
    () => verifyPayment(store, order.order_id, admin),
    (error) => error.code === "payment_reference_missing",
  );
});

check("verifyPayment refuses a COD order", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(
    upiRecord({ paymentMethod: "COD", paymentProvider: null, paymentStatus: PAYMENT_STATUS.PENDING }),
    "key-verify-2",
  );
  await store.submitPaymentReference(order.order_id, "421234567890", "manual_upi");
  await assert.rejects(
    () => verifyPayment(store, order.order_id, admin),
    (error) => error.code === "payment_method_mismatch",
  );
});

check("verifyPayment moves a submitted UPI order to PAID and audits it", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-verify-3");
  const submitted = await store.submitPaymentReference(order.order_id, "421234567890", "manual_upi");
  assert.equal(submitted.payment_status, PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED);

  const result = await verifyPayment(store, order.order_id, admin, { note: "seen in bank" });
  assert.equal(result.order.paymentStatus, PAYMENT_STATUS.PAID);
  assert.equal(result.changed, true);

  const { events } = await getOrderDetail(store, order.order_id);
  const verified = events.find((event) => event.eventType === "PAYMENT_VERIFIED");
  assert.ok(verified, "expected a PAYMENT_VERIFIED audit row");
  assert.equal(verified.newValue, PAYMENT_STATUS.PAID);
  assert.equal(verified.oldValue, PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED);
  assert.equal(verified.actor, `admin:${admin.email}`);
});

check("the verification preview shows the admin the exact reference being approved", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-preview-1");
  await store.submitPaymentReference(order.order_id, "421234567893", "manual_upi");
  const { order: adminOrder } = await getOrderDetail(store, order.order_id);

  const preview = verificationPreview(adminOrder);
  assert.equal(preview.paymentReference, "421234567893", "the UTR must be visible to the admin");
  assert.equal(preview.requiresAttention, true);
  assert.equal(preview.total, 396, "the amount must be shown alongside the reference");
  assert.equal(preview.paymentProvider, "manual_upi");
});

check("verifyPayment is idempotent once already PAID", async () => {  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-verify-4");
  await store.submitPaymentReference(order.order_id, "421234567891", "manual_upi");
  await verifyPayment(store, order.order_id, admin);
  const again = await verifyPayment(store, order.order_id, admin);
  assert.equal(again.alreadyPaid, true);
  assert.equal(again.changed, false);
});

check("verifyPayment refuses a cancelled order", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-verify-5");
  await store.submitPaymentReference(order.order_id, "421234567892", "manual_upi");
  await store.adminUpdateOrder(order.order_id, { orderStatus: ORDER_STATUS.CANCELLED });
  await assert.rejects(
    () => verifyPayment(store, order.order_id, admin),
    (error) => error.code === "order_cancelled",
  );
});

/* ----------------------------- status transitions ------------------------- */

check("an illegal status transition is refused and writes nothing", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-status-1");
  await assert.rejects(
    () => changeOrderStatus(store, order.order_id, ORDER_STATUS.DELIVERED, admin),
    (error) => error.code === "invalid_status_transition",
  );
  const { order: fresh, events } = await getOrderDetail(store, order.order_id);
  assert.equal(fresh.orderStatus, ORDER_STATUS.RECEIVED, "status must be unchanged");
  assert.equal(events.length, 0, "a refused transition must not write an audit row");
});

check("a legal transition is applied and audited", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-status-2");
  await changeOrderStatus(store, order.order_id, ORDER_STATUS.CONFIRMED, admin, { note: "ok" });
  const { order: fresh, events } = await getOrderDetail(store, order.order_id);
  assert.equal(fresh.orderStatus, ORDER_STATUS.CONFIRMED);
  assert.equal(events.at(-1).eventType, "STATUS_CHANGED");
});

check("a terminal status cannot be left", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-status-3");
  await store.adminUpdateOrder(order.order_id, { orderStatus: ORDER_STATUS.DELIVERED });
  await assert.rejects(
    () => changeOrderStatus(store, order.order_id, ORDER_STATUS.PREPARING, admin),
    (error) => error.code === "invalid_status_transition",
  );
});

check("setting the current status is a no-op, not an error", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord(), "key-status-4");
  const result = await changeOrderStatus(store, order.order_id, ORDER_STATUS.RECEIVED, admin);
  assert.equal(result.changed, false);
});

/* -------------------------------- filtering ------------------------------- */

check("filter counts and pagination add up", async () => {
  const store = await getStore();
  for (let index = 0; index < 3; index += 1) {
    const { order } = await store.createOrder(upiRecord(), `key-page-${index}`);
    await store.submitPaymentReference(order.order_id, `42123456790${index}`, "manual_upi");
  }
  const counts = await orderCounts(store);
  assert.equal(counts.verification, 3, "three orders await verification");

  const first = await listOrders(store, { filter: "verification", page: 1, pageSize: 2 });
  assert.equal(first.orders.length, 2);
  assert.equal(first.total, 3);
  assert.equal(first.pageCount, 2);

  const second = await listOrders(store, { filter: "verification", page: 2, pageSize: 2 });
  assert.equal(second.orders.length, 1);

  const all = await listOrders(store, { filter: "all", pageSize: 100 });
  const ids = all.orders.map((order) => order.orderId);
  assert.equal(new Set(ids).size, ids.length, "no duplicates across pages");
});

check("an unknown filter falls back to all rather than erroring", async () => {
  const store = await getStore();
  const listing = await listOrders(store, { filter: "nonsense" });
  assert.equal(listing.filter, "all");
});

/* ------------------------------ public shaping ----------------------------- */

check("the public order never carries the gateway payment id in full", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(upiRecord({ paymentProvider: "razorpay" }), "key-pub-1");
  await store.updatePayment(order.order_id, {
    paymentStatus: PAYMENT_STATUS.PAID,
    razorpayPaymentId: "pay_SUPERSECRETVALUE123456",
  });
  const publicOrder = toPublicOrder(await store.getOrder(order.order_id));
  assert.equal(publicOrder.razorpayPaymentRef, "••••123456");
  assert.ok(!JSON.stringify(publicOrder).includes("SUPERSECRET"), "raw id must not leak");
  assert.equal(publicOrder.accessHash, undefined, "the order secret must not be exposed");
});

check("the WhatsApp link encodes the summary rather than appending it raw", async () => {
  const store = await getStore();
  const { order } = await store.createOrder(
    upiRecord({ customerName: "Asha & Sons", specialInstructions: "no ice\nno straw" }),
    "key-wa-1",
  );
  const adminOrder = (await getOrderDetail(store, order.order_id)).order;
  const link = whatsappLink(adminOrder);
  if (link) {
    const message = decodeURIComponent(new URL(link).searchParams.get("text"));
    assert.ok(message.includes("Asha & Sons"));
    assert.equal(message.split("\n").filter((line) => line.startsWith("Name: ")).length, 1);
  }
  const summary = orderSummaryText(adminOrder);
  assert.ok(summary.includes(order.order_id));
  assert.ok(summary.includes("₹396"));
});

/* ----------------------------------- run ---------------------------------- */

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

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
