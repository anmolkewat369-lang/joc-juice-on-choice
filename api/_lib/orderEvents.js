/**
 * Order audit trail writer.
 *
 * `joc_order_events` is append-only: nothing in the application updates or
 * deletes a row, so an order's history is reconstructable after the fact. This
 * is the only place that writes to it, which keeps the audit shape identical
 * whether the writer is a customer action, an admin action or the system.
 *
 * A failed audit write never fails the action that caused it — the order row is
 * the source of truth; the trail is the record of it.
 */

const SYSTEM_ACTOR = "system";

/** Append one event against an order row. */
export function appendOrderEvent(store, row, event) {
  return store.appendEvent({
    orderUuid: row.id,
    orderRef: row.order_id,
    actor: SYSTEM_ACTOR,
    ...event,
  });
}

/** The first row of every order's history, as a plain event. */
export const orderCreatedEvent = (row, { provider, actor = "customer" } = {}) => ({
  eventType: "ORDER_CREATED",
  newValue: row.order_status,
  actor,
  note: provider ? `Payment provider: ${provider}` : null,
});

/** The first row of every order's history. */
export const appendOrderCreated = (store, row, options) =>
  appendOrderEvent(store, row, orderCreatedEvent(row, options));

/**
 * Best-effort variant for use after the fact: logs a failure instead of
 * propagating it, so a broken audit insert cannot reject a customer's order.
 */
export async function recordEventQuietly(store, row, event) {
  try {
    await appendOrderEvent(store, row, event);
  } catch (error) {
    console.error("[joc-orders] could not write an order event:", error?.message ?? error);
  }
}
