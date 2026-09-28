/**
 * GET /api/payments/methods — what the customer can actually pay with.
 *
 * A public, unauthenticated read of *capability*, not of configuration: it says
 * whether a digital payment is offered and which rail settles it, and it never
 * returns a UPI ID, a gateway key, or anything else sensitive. The checkout
 * renders its options from this response so the UI can never offer a method the
 * server would then refuse.
 *
 * The UPI ID, amount, intent URI and QR are deliberately absent here. Those are
 * only returned with an order the caller owns, because the amount must come from
 * the priced order rather than from anything the browser supplies.
 */

import { methodGuard, sendJson } from "../_lib/http.js";
import { availableMethods, activeProvider } from "../_lib/payments.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  return sendJson(res, 200, {
    methods: availableMethods(),
    provider: activeProvider(),
  });
}
