/**
 * Admin order operations.
 *
 * Everything the dashboard can do to an order passes through here, and every
 * action is a named, guarded operation rather than a free-form patch. The
 * browser says *what it wants to do* ("verify this payment", "mark it
 * preparing"); the server decides whether that is allowed, and writes an audit
 * row either way.
 *
 * Two rules are enforced here rather than in the UI, because a UI is not a
 * security boundary:
 *   1. a manual UPI payment becomes PAID only through `verifyPayment`, which
 *      requires a reference to already exist and an authenticated admin;
 *   2. an order status only moves along a legal transition, and CANCELLED and
 *      DELIVERED are terminal.
 */

import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  ATTENTION_PAYMENT_STATUSES,
  canTransitionOrderStatus,
} from "../../shared/ordering.js";
import { toAdminOrder, toAdminEvent, toAdminNotification } from "./store.js";
import { appendOrderEvent } from "./orderEvents.js";
import { isOrderId } from "./orderToken.js";
import { ApiError } from "./http.js";
import { notifyOrderStatus, notifyPaymentVerified } from "./notify.js";
import { notifyCustomerOrderConfirmedPush } from "./push.js";

export { isOrderId } from "./orderToken.js";
/* --------------------------------- filters ------------------------------- */

/**
 * Dashboard filters. Each maps to a fixed SQL fragment, so nothing a client
 * sends can ever reach the query as SQL.
 */
export const ORDER_FILTERS = {
  all: { label: "All", where: () => [] },
  new: {
    label: "New",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.RECEIVED }],
  },
  verification: {
    label: "Pending verification",
    where: () => [
      { sql: "payment_status = ?", value: PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED },
    ],
  },
  confirmed: {
    label: "Confirmed",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.CONFIRMED }],
  },
  preparing: {
    label: "Preparing",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.PREPARING }],
  },
  ready: {
    label: "Ready",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.READY }],
  },
  out_for_delivery: {
    label: "Out for delivery",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.OUT_FOR_DELIVERY }],
  },
  delivered: {
    label: "Delivered",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.DELIVERED }],
  },
  cancelled: {
    label: "Cancelled",
    where: () => [{ sql: "order_status = ?", value: ORDER_STATUS.CANCELLED }],
  },
};

/**
 * Count badges for the filter bar.
 *
 * A single grouped query rather than N filter queries, so the dashboard header
 * costs one round trip regardless of how many orders exist.
 */
export async function orderCounts(store) {
  const groups = await store.statusCounts();
  const counts = Object.fromEntries(Object.keys(ORDER_FILTERS).map((key) => [key, 0]));
  for (const group of groups) {
    counts.all += group.count;
    const key = STATUS_FILTER_BY_VALUE.get(group.orderStatus);
    if (key) counts[key] += group.count;
    if (group.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED) {
      counts.verification += group.count;
    }
  }
  return counts;
}

/** Reverse lookup: order status value -> filter key. */
const STATUS_FILTER_BY_VALUE = new Map(
  Object.entries(ORDER_FILTERS)
    .filter(([, definition]) => definition.where()[0]?.value !== undefined)
    .map(([key, definition]) => [definition.where()[0].value, key]),
);

/* ---------------------------------- reads -------------------------------- */

/** Newest first, paginated. */
export async function listOrders(store, { filter = "all", page, pageSize } = {}) {
  const chosen = ORDER_FILTERS[filter] ? filter : "all";
  const bounds = pageBoundsFrom({ page, pageSize });
  const { rows, total } = await store.listOrders({
    where: ORDER_FILTERS[chosen].where(),
    limit: bounds.limit,
    offset: bounds.offset,
  });
  return {
    orders: rows.map(toAdminOrder),
    filter: chosen,
    page: bounds.page,
    pageSize: bounds.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / bounds.pageSize)),
  };
}

function pageBoundsFrom({ page, pageSize }) {
  const size = Math.min(Math.max(1, Number.parseInt(pageSize, 10) || 20), 100);
  const number = Math.max(1, Number.parseInt(page, 10) || 1);
  return { limit: size, offset: (number - 1) * size, page: number, pageSize: size };
}

/**
 * Everything the drawer shows for one order.
 *
 * `notifications` is the send ledger for that order, so an admin can answer "did
 * the confirmation actually go out?" from the screen instead of digging through
 * logs. Recipients arrive masked (see `toAdminNotification`).
 *
 * The ledger is best-effort from the caller's point of view: a failure to read it
 * must not hide an order that exists and can be actioned, so it degrades to an
 * empty list rather than a 500.
 */
export async function getOrderDetail(store, orderId) {
  if (!isOrderId(orderId)) {
    throw new ApiError(404, "That order does not exist.", "order_not_found");
  }
  const row = await store.getOrder(String(orderId).toUpperCase());
  if (!row) throw new ApiError(404, "That order does not exist.", "order_not_found");
  const [events, notifications] = await Promise.all([
    store.listOrderEvents(row.id),
    store.listNotifications(row.id).catch(() => []),
  ]);
  return {
    order: toAdminOrder(row),
    events: events.map(toAdminEvent),
    notifications: notifications.map(toAdminNotification),
  };
}

/* --------------------------------- actions ------------------------------- */

const isCancelled = (order) => order.order_status === ORDER_STATUS.CANCELLED;

/**
 * Move an order along the lifecycle.
 *
 * Illegal transitions are refused with a message the dashboard can show, and
 * nothing is written — not even an audit row — because nothing happened.
 */
export async function changeOrderStatus(store, orderId, nextStatus, admin, { note } = {}) {
  const row = await store.getOrder(String(orderId).toUpperCase());
  if (!row) throw new ApiError(404, "That order does not exist.", "order_not_found");

  const current = row.order_status;
  if (current === nextStatus) {
    return { order: toAdminOrder(row), changed: false };
  }
  if (!canTransitionOrderStatus(current, nextStatus)) {
    throw new ApiError(
      409,
      `An order that is ${current.replaceAll("_", " ").toLowerCase()} cannot become ${String(
        nextStatus,
      )
        .replaceAll("_", " ")
        .toLowerCase()}.`,
      "invalid_status_transition",
    );
  }

  const updated = await store.adminUpdateOrder(row.order_id, { orderStatus: nextStatus });
  await appendOrderEvent(store, row, {
    eventType: "STATUS_CHANGED",
    field: "order_status",
    oldValue: current,
    newValue: nextStatus,
    actor: adminLabel(admin),
    note: note ?? null,
  });

  // Tell the customer, after the write has succeeded and never before. Ordering
  // matters in both directions: notifying first would send "we are preparing
  // your order" for a change that then failed to save, and the ledger entry would
  // now block the retry from ever telling them. Awawnted rather than fire-and-
  // forget so the send is not abandoned when the function returns.
  await notifyOrderStatus(store, updated);

  // Web Push is a second channel for the same transition, not a replacement for
  // the email above. Only CONFIRMED is wired now; the helper is event-driven, so
  // extending it to PREPARING/READY/… later is one line here. It is awaited so
  // the send is not abandoned when the function returns, and it is incapable of
  // throwing or of failing the status change that already succeeded.
  if (nextStatus === ORDER_STATUS.CONFIRMED) {
    await notifyCustomerOrderConfirmedPush(store, updated);
  }

  return { order: toAdminOrder(updated), changed: true };
}

/**
 * The only path from a manual UPI payment to PAID.
 *
 * Requires: an authenticated admin (enforced by the route), an order that is
 * not cancelled, a UPI payment method, a payment reference already submitted by
 * the customer, and a payment that is not already PAID. The reference is
 * surfaced to the admin in the response so the verification screen can show them
 * the exact UTR they are approving — an admin must never click "verify" without
 * seeing what they are verifying.
 */
export async function verifyPayment(store, orderId, admin, { note } = {}) {
  const row = await store.getOrder(String(orderId).toUpperCase());
  if (!row) throw new ApiError(404, "That order does not exist.", "order_not_found");

  if (isCancelled(row)) {
    throw new ApiError(
      409,
      "This order is cancelled, so its payment cannot be verified.",
      "order_cancelled",
    );
  }
  if (row.payment_method !== "UPI") {
    throw new ApiError(409, "This order is not a digital payment.", "payment_method_mismatch");
  }
  if (row.payment_status === PAYMENT_STATUS.PAID) {
    return { order: toAdminOrder(row), changed: false, alreadyPaid: true };
  }
  if (!row.payment_reference) {
    throw new ApiError(
      409,
      "The customer has not submitted a UTR for this order yet.",
      "payment_reference_missing",
    );
  }

  const previous = row.payment_status;
  const verifiedAt = new Date().toISOString();
  const updated = await store.adminUpdateOrder(row.order_id, {
    paymentStatus: PAYMENT_STATUS.PAID,
    paymentVerifiedAt: verifiedAt,
    paymentVerifiedBy: admin.id,
    paymentProvider: row.payment_provider ?? "manual_upi",
  });

  await appendOrderEvent(store, row, {
    eventType: "PAYMENT_VERIFIED",
    field: "payment_status",
    oldValue: previous,
    newValue: PAYMENT_STATUS.PAID,
    actor: adminLabel(admin),
    note: note ?? `UTR ${row.payment_reference} confirmed by ${admin.email}`,
    metadata: { paymentReference: row.payment_reference, total: row.total },
  });

  // The customer's money is confirmed — the one moment they most want to know,
  // and the one moment worth being certain went out exactly once. Same ordering
  // rule as the status change: after the write, never before.
  await notifyPaymentVerified(store, updated);

  return { order: toAdminOrder(updated), changed: true };
}

/** Detail an admin needs before deciding, so "Verify Payment" can be confirmed. */
export function verificationPreview(order) {
  return {
    orderId: order.orderId,
    customerName: order.customerName,
    total: order.total,
    currency: order.currency,
    paymentMethod: order.paymentMethod,
    paymentProvider: order.paymentProvider,
    paymentStatus: order.paymentStatus,
    paymentReference: order.paymentReference,
    orderStatus: order.orderStatus,
    requiresAttention: ATTENTION_PAYMENT_STATUSES.has(order.paymentStatus),
  };
}

export const adminLabel = (admin) =>
  admin?.email ? `admin:${admin.email}` : "admin:unknown";
