/**
 * Notification checks.
 *
 * Two properties matter more than the wording of any email, and both are tested
 * here:
 *
 *   1. NOTHING A NOTIFIER DOES CAN FAIL AN ORDER. The order is already committed
 *      by the time a message is sent, so a broken Resend key, a bad from address
 *      or a dead ledger must leave the order exactly as it was.
 *   2. AT MOST ONE MESSAGE PER FACT. The customer must not receive "your order is
 *      preparing" three times because the dashboard was clicked twice, and must
 *      not receive nothing at all because two requests raced.
 *
 * The Resend transport is stubbed at `fetch`, so the real `sendEmail`, the real
 * ledger and the real dedupe keys are all exercised. Non-Resend URLs pass
 * through to the original implementation.
 */

import assert from "node:assert/strict";

import {
  NOTIFICATION_TYPE,
  notifyNewOrder,
  notifyOrderReceived,
  orderSummaryText,
  trackingLink,
  whatsappLink,
} from "../api/_lib/notify.js";
import { getStore, newAccessToken, toAdminOrder, _resetStoreCache } from "../api/_lib/store.js";
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from "../shared/ordering.js";
import { changeOrderStatus, verifyPayment } from "../api/_lib/ordersAdmin.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;

/* ------------------------------- mail stub --------------------------------- */

const mail = {
  /** null to simulate the provider being unreachable. */
  failure: null,
  /** A non-2xx status, which Resend uses for a rejected sender or address. */
  httpStatus: 200,
  sent: [],
};

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  if (!url.includes("api.resend.com")) return realFetch(input, init);

  if (mail.failure) {
    throw new TypeError("fetch failed");
  }

  const payload = JSON.parse(String(init?.body ?? "{}"));
  mail.sent.push(payload);
  return {
    ok: mail.httpStatus >= 200 && mail.httpStatus < 300,
    status: mail.httpStatus,
    json: async () => ({ id: `resend-${mail.sent.length}` }),
    text: async () => JSON.stringify({ id: `resend-${mail.sent.length}` }),
  };
};

const withMailEnv = (over, fn) => async () => {
  const before = {
    key: process.env.RESEND_API_KEY,
    from: process.env.JOC_NOTIFY_FROM,
    adminTo: process.env.JOC_NOTIFY_EMAIL,
    failure: mail.failure,
    httpStatus: mail.httpStatus,
    sent: mail.sent,
  };
  Object.assign(mail, { failure: null, httpStatus: 200, sent: [] }, over);
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.JOC_NOTIFY_FROM = "JOC <orders@joc.test>";
  try {
    return await fn();
  } finally {
    for (const [key, value] of [
      ["RESEND_API_KEY", before.key],
      ["JOC_NOTIFY_FROM", before.from],
      ["JOC_NOTIFY_EMAIL", before.adminTo],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    Object.assign(mail, {
      failure: before.failure,
      httpStatus: before.httpStatus,
      sent: before.sent,
    });
  }
};

/* --------------------------------- fixtures -------------------------------- */

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const ADDRESS = "Plot 42, Civil Lines, Jabalpur 482001";

const baseRecord = (over = {}) => ({
  customerName: "Asha Rao",
  phone: "9876543210",
  customerEmail: "asha@example.com",
  // The area the customer chose and their confirmation of the address. No
  // distance: nothing measures one, so there is nothing to store or report.
  deliveryArea: "civil-lines",
  deliveryAreaConfirmed: true,
  address: ADDRESS,
  landmark: "Near the petrol pump",
  specialInstructions: "Less ice",
  items: [{ id: "citrus-ginger", name: "Ginger Citrus", qty: 2, lineTotal: 396 }],
  subtotal: 396,
  deliveryCharge: 0,
  total: 396,
  currency: "INR",
  paymentMethod: PAYMENT_METHOD.UPI,
  paymentStatus: PAYMENT_STATUS.PENDING,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentProvider: "manual_upi",
  ...over,
});

/** Create an order the way the order route does, including its per-order secret. */
const createOrder = async (over, key) => {
  const store = await getStore();
  const accessToken = newAccessToken();
  const record = baseRecord(over);
  const { order: row } = await store.createOrder(
    { ...record, accessToken, trackingToken: accessToken },
    key,
  );
  return { store, row, accessToken };
};

const ledgerFor = async (store, row) => store.listNotifications(row.id);

const statuses = (rows) => rows.map((row) => row.status).sort();

/* ---------------------------------- content -------------------------------- */

check("the admin summary reports the chosen area and the confirmation", async () => {
  const { row } = await createOrder({}, "content-summary-1");
  const text = orderSummaryText(toAdminOrder(row));
  // The area is shown by its label, not its slug: this message is read on a phone
  // by whoever is doing the delivery run, not by a developer with the source open.
  assert.match(text, /Civil Lines/, "the admin plans a run from this area");
  assert.match(text, /address confirmed/, "and knows the customer confirmed the address");
  assert.match(text, /JOC-/, "the order id must be in the message");
  // The old summary told the admin a measured road distance. Nothing measures one
  // now, so a figure appearing here would mean a claim JOC cannot support.
  assert.doesNotMatch(text, /by road/, "no road-distance claim may appear");
  assert.doesNotMatch(text, /\d+(\.\d+)? km/, "no distance figure may appear");
});

check("an order placed before the area list says so, rather than guessing", async () => {
  const { row } = await createOrder(
    { deliveryArea: null, deliveryAreaConfirmed: false },
    "content-unverified-1",
  );
  const text = orderSummaryText(toAdminOrder(row));
  assert.equal(text.includes("civil-lines"), false, "no area may be invented for it");
  assert.match(text, /No area recorded/, "the admin is told to confirm the address");
  assert.equal(whatsappLink(toAdminOrder(row)), null, "no WhatsApp number is configured here");
});

check("the tracking token travels in the fragment, never the query string", () => {
  const link = trackingLink("JOC-20260930-0001", "abc123");
  assert.equal(link, "https://joc.vercel.app/#/order/JOC-20260930-0001?t=abc123");
  assert.equal(
    link.split("#")[0].includes("abc123"),
    false,
    "nothing before the fragment reaches a server log",
  );
  assert.equal(link.includes("?t="), true);
  assert.ok(
    link.indexOf("t=abc123") > link.indexOf("#"),
    "the token is after the #, where nothing is logged",
  );
});

check("a tracking link is not invented without a token", () => {
  assert.equal(trackingLink("JOC-20260930-0001", null), null);
  assert.equal(trackingLink(null, "abc123"), null);
});

/* ------------------------------ exactly once ------------------------------- */

check(
  "a customer confirmation is sent once, however many times it is triggered",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "dedupe-received-1");

    await notifyOrderReceived(store, row);
    await notifyOrderReceived(store, row);
    await notifyOrderReceived(store, row);

    assert.equal(mail.sent.length, 1, "exactly one confirmation, not three");
    const rows = await ledgerFor(store, row);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].recipient, "asha@example.com");
  }),
);

check(
  "concurrent triggers produce one message, not a race",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "dedupe-race-1");

    // Promise.all, deliberately: the real race is two dashboard clicks or a
    // retried webhook arriving together.
    const results = await Promise.all([
      notifyOrderReceived(store, row),
      notifyOrderReceived(store, row),
      notifyOrderReceived(store, row),
    ]);

    assert.equal(mail.sent.length, 1);
    assert.equal(results.filter((result) => result.sent).length, 1);
    assert.equal((await ledgerFor(store, row)).length, 1);
  }),
);

check(
  "the same status twice sends one message; a genuinely new status sends another",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "dedupe-status-1");
    const admin = { id: "auth-1", email: "anmolkewat369@gmail.com" };

    await changeOrderStatus(store, row.order_id, ORDER_STATUS.CONFIRMED, admin);
    await changeOrderStatus(store, row.order_id, ORDER_STATUS.PREPARING, admin);
    await changeOrderStatus(store, row.order_id, ORDER_STATUS.READY, admin);
    await changeOrderStatus(store, row.order_id, ORDER_STATUS.READY, admin);

    const rows = await ledgerFor(store, row);
    const customerStatusRows = rows.filter(
      (entry) => entry.notification_type === NOTIFICATION_TYPE.CUSTOMER_STATUS,
    );
    assert.equal(
      customerStatusRows.length,
      3,
      "one per distinct status, and re-asserting the current status is not a new fact",
    );
    assert.deepEqual(statuses(customerStatusRows), ["sent", "sent", "sent"]);
  }),
);

check(
  "a payment confirmation is sent once, even when the admin verifies twice",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "dedupe-payment-1");
    const admin = { id: "auth-1", email: "anmolkewat369@gmail.com" };

    // A UTR can only arrive through the customer-facing route, so it is written
    // the same guarded way rather than being part of the fixture.
    await store.adminUpdateOrder(row.order_id, {
      paymentStatus: PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED,
      paymentReference: "421234567890",
    });

    const first = await verifyPayment(store, row.order_id, admin);
    assert.equal(first.order.paymentStatus, PAYMENT_STATUS.PAID);
    const second = await verifyPayment(store, row.order_id, admin);
    assert.equal(second.alreadyPaid, true);

    const rows = await ledgerFor(store, row);
    assert.equal(
      rows.filter((entry) => entry.notification_type === NOTIFICATION_TYPE.CUSTOMER_PAYMENT_VERIFIED)
        .length,
      1,
    );
  }),
);

/* ------------------------------ no recipients ------------------------------ */

check(
  "an order with no email address records a skip and sends nothing",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({ customerEmail: null }, "skip-noemail-1");

    await notifyOrderReceived(store, row);
    await notifyOrderReceived(store, row);

    assert.equal(mail.sent.length, 0);
    const rows = await ledgerFor(store, row);
    assert.equal(rows.length, 1, "the decision is recorded once, not on every status change");
    assert.equal(rows[0].status, "skipped");
    assert.equal(rows[0].recipient, "none");
  }),
);

check(
  "unconfigured mail is skipped rather than attempted",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "skip-unconfigured-1");
    delete process.env.RESEND_API_KEY;
    delete process.env.JOC_NOTIFY_FROM;

    await notifyOrderReceived(store, row);
    assert.equal(mail.sent.length, 0, "no provider call when there is nowhere to send from");

    const rows = await ledgerFor(store, row);
    assert.equal(rows[0].status, "skipped");
  }),
);

/** Resend is addressed with an array, even for one recipient. */
const recipientsOf = (message) => [message.to].flat().filter(Boolean);

check(
  "the admin alert goes to the configured address, not the customer's",
  withMailEnv({}, async () => {
    process.env.JOC_NOTIFY_EMAIL = "ops@joc.test";
    const { store, row } = await createOrder({}, "admin-alert-1");

    await notifyNewOrder(store, row);
    assert.equal(mail.sent.length, 1);
    assert.deepEqual(recipientsOf(mail.sent[0]), ["ops@joc.test"]);
    assert.ok(
      !recipientsOf(mail.sent[0]).includes("asha@example.com"),
      "the customer's address is order detail, never the recipient",
    );

    // And the admin alert is also exactly-once.
    await notifyNewOrder(store, row);
    assert.equal(mail.sent.length, 1);
  }),
);

/* --------------------------- failures stay contained ----------------------- */

check(
  "a provider failure is recorded and never thrown at the caller",
  withMailEnv({ failure: true }, async () => {
    const { store, row } = await createOrder({}, "failure-network-1");

    const result = await notifyOrderReceived(store, row);
    assert.equal(result.sent, false);
    assert.ok(result.reason, "the reason is recorded for the operator");

    const rows = await ledgerFor(store, row);
    assert.equal(rows[0].status, "failed");
    assert.ok(rows[0].last_error, "the failure reason is kept for an operator to read");
  }),
);

check(
  "a rejected message (bad sender, bad recipient) is recorded as failed, not sent",
  withMailEnv({ httpStatus: 403 }, async () => {
    const { store, row } = await createOrder({}, "failure-rejected-1");
    const result = await notifyOrderReceived(store, row);
    assert.equal(result.sent, false);
    assert.equal(result.reason, "rejected");
    assert.equal((await ledgerFor(store, row))[0].status, "failed");
  }),
);

check(
  "a broken mail provider cannot fail the order that triggered it",
  withMailEnv({ failure: true }, async () => {
    const { store, row } = await createOrder({}, "failure-order-survives-1");
    const admin = { id: "auth-1", email: "anmolkewat369@gmail.com" };

    const result = await changeOrderStatus(store, row.order_id, ORDER_STATUS.CONFIRMED, admin);
    assert.equal(result.changed, true, "the status change must still be applied");

    const after = await store.getOrder(row.order_id);
    assert.equal(after.order_status, ORDER_STATUS.CONFIRMED);
  }),
);

check(
  "an unreachable ledger still sends, rather than silently dropping the message",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "failure-ledger-down-1");
    const broken = {
      ...store,
      claimNotification: async () => {
        throw new Error("connection terminated unexpectedly");
      },
      listNotifications: store.listNotifications,
    };

    const result = await notifyOrderReceived(broken, row);
    assert.equal(result.sent, true, "losing exactly-once is better than losing the message");
  }),
);

/* ------------------------------ secret handling ---------------------------- */

check("the tracking token is never part of an order payload", async () => {
  const { row, accessToken } = await createOrder({ customerEmail: "asha@example.com" }, "secret-1");
  assert.ok(row.tracking_token, "the token is stored so later emails can link to the order");
  assert.equal(row.tracking_token, accessToken, "it is the same secret, not a second one");

  const serialised = JSON.stringify(toAdminOrder(row));
  assert.equal(serialised.includes(row.tracking_token), false, "the admin payload must not carry it");
  assert.equal(serialised.includes("tracking_token"), false);
  assert.equal(serialised.includes(accessToken), false);
});

check(
  "a customer email carries the tracking link and nothing that leaks the token elsewhere",
  withMailEnv({}, async () => {
    const { store, row } = await createOrder({}, "secret-link-1");
    await notifyOrderReceived(store, row);

    const body = mail.sent[0].html ?? "";
    const text = mail.sent[0].text ?? "";
    assert.match(body, /#\/order\/JOC-/, "the confirmation links to the live order");
    assert.equal(
      body.includes(`?t=${row.tracking_token}`) || text.includes(`?t=${row.tracking_token}`),
      true,
      "the link carries the token in its fragment",
    );
    assert.deepEqual(
      recipientsOf(mail.sent[0]),
      ["asha@example.com"],
      "the customer's mail goes to the customer, never to the admin address",
    );
  }),
);

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
