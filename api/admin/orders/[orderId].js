/**
 * GET   /api/admin/orders/[orderId] — full order + audit trail
 * PATCH /api/admin/orders/[orderId] — one guarded action
 *
 * The PATCH body carries an *action*, never a set of fields:
 *
 *   { "action": "setStatus", "status": "PREPARING", "note": "..." }
 *   { "action": "verifyPayment", "note": "UTR confirmed in bank statement" }
 *
 * That shape is the point. There is no way for a request to say
 * `paymentStatus: "PAID"` directly, so no future bug in this file can be turned
 * into a "mark any order paid" hole, and every write lands in the audit trail
 * under a name a human can read later.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson } from "../../_lib/http.js";
import { getStore } from "../../_lib/store.js";
import { requireAdmin } from "../../_lib/adminAuth.js";
import {
  changeOrderStatus,
  getOrderDetail,
  verifyPayment,
  verificationPreview,
} from "../../_lib/ordersAdmin.js";
import { orderIdFrom } from "../../_lib/orderToken.js";
import { whatsappLink } from "../../_lib/notify.js";
import { ORDER_STATUS, PAYMENT_STATUS } from "../../../shared/ordering.js";

/** The only statuses a client may ask for. Anything else is rejected as unknown. */
const ALLOWED_STATUSES = new Set(Object.values(ORDER_STATUS));

const cleanNote = (value) => {
  const note = String(value ?? "").trim();
  return note ? note.slice(0, 500) : undefined;
};

const ACTIONS = {
  setStatus(store, { orderId, body, admin }) {
    const status = String(body?.status ?? "").toUpperCase();
    if (!ALLOWED_STATUSES.has(status)) {
      throw new ApiError(422, "That is not a valid order status.", "unknown_status");
    }
    return changeOrderStatus(store, orderId, status, admin, { note: cleanNote(body?.note) });
  },

  verifyPayment(store, { orderId, body, admin }) {
    return verifyPayment(store, orderId, admin, { note: cleanNote(body?.note) });
  },
};

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "PATCH"])) return;

  try {
    const admin = requireAdmin(req);
    const store = await getStore();
    const orderId = orderIdFrom(req, "orderId");

    if (req.method === "GET") {
      const detail = await getOrderDetail(store, orderId);
      return sendJson(res, 200, {
        ...detail,
        verification: verificationPreview(detail.order),
        // Pre-built, so the admin can share the order without the dashboard
        // re-implementing message encoding. Tapping it still requires a send.
        whatsapp: whatsappLink(detail.order),
      });
    }

    const body = await readJson(req);
    const action = String(body?.action ?? "").trim();
    const run = ACTIONS[action];
    if (!run) {
      throw new ApiError(
        422,
        "That action is not supported. Use setStatus or verifyPayment.",
        "unknown_action",
      );
    }

    const result = await run(store, { orderId, body, admin });
    const detail = await getOrderDetail(store, result.order.orderId);

    return sendJson(res, 200, {
      ...detail,
      verification: verificationPreview(detail.order),
      changed: result.changed,
      paymentStatus: detail.order.paymentStatus,
      requiresAttention: detail.order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
