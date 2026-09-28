/**
 * GET /api/admin/orders — the dashboard list.
 *
 * Every admin route starts by verifying the session cookie. There is no
 * API-key, no "internal" header and no origin-based bypass: no valid admin
 * cookie, no data.
 *
 * The response also carries the WhatsApp number, because it comes from a server
 * environment variable and the dashboard should not hardcode it. The number is
 * public by nature — it is the shop's contact number — and no message is ever
 * sent automatically.
 */

import { methodGuard, sendError, sendJson } from "../../_lib/http.js";
import { getStore } from "../../_lib/store.js";
import { requireAdmin } from "../../_lib/adminAuth.js";
import { listOrders, orderCounts } from "../../_lib/ordersAdmin.js";
import { whatsappNumber, emailConfig } from "../../_lib/notify.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  try {
    // Throws 401 with no valid admin session. There is no fallback path.
    const admin = requireAdmin(req);

    const store = await getStore();
    const { page, pageSize } = req.query ?? {};

    const [listing, counts] = await Promise.all([
      listOrders(store, { filter: req.query?.filter, page, pageSize }),
      orderCounts(store),
    ]);

    return sendJson(res, 200, {
      ...listing,
      counts,
      // The dashboard's own notification affordances, told apart honestly so the
      // UI can say "email is off" rather than silently promising an email.
      notify: {
        whatsappNumber: whatsappNumber(),
        whatsappIsManual: true,
        email: emailConfig().enabled,
      },
      admin: { id: admin.id, email: admin.email },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
