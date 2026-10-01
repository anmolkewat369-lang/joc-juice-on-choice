/**
 * Shared request handling for order creation, so the POST /api/orders route
 * stays readable and the trust boundary lives in one place.
 */

import { ApiError } from "./http.js";
import { priceItems } from "./catalogue.js";
import { validateCheckout, PAYMENT_STATUS, ORDER_STATUS, PAYMENT_METHOD } from "../../shared/ordering.js";
import { newAccessToken, ORDER_DEFAULTS } from "./store.js";
import { providerForNewOrder } from "./payments.js";

const IDEMPOTENCY_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * A missing or malformed Idempotency-Key is rejected rather than invented.
 * Generating one server-side would defeat the purpose: a retry would then look
 * like a brand new order.
 */
export function readIdempotencyKey(req) {
  const header = req.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== "string" || !IDEMPOTENCY_RE.test(key)) {
    throw new ApiError(
      400,
      "Missing order token. Please refresh and try again.",
      "idempotency_key_required",
    );
  }
  return key;
}

/**
 * Validate the request and produce a priced order record.
 *
 * The browser supplies ids, quantities and customer text — and nothing about
 * money. Subtotal, delivery charge and total are all computed here from the
 * shared menu data, so a tampered payload cannot change what is charged.
 *
 * The delivery area arrives the same way: the customer picks one from the
 * configured list and confirms their address, `validateCheckout` checks both
 * against that list, and this record carries the normalised id, the label resolved
 * from the list and a real boolean. No distance is measured and none is stored.
 */
export function buildOrderRecord(body) {
  const { errors, valid, value } = validateCheckout(body);
  if (!valid) {
    // The whole field map travels in `errors`, and the first message becomes the
    // headline. They are separate slots because a client must be able to tell
    // "this input is wrong" apart from "here is some context about the refusal".
    throw new ApiError(422, firstError(errors), "invalid_checkout", null, errors);
  }

  const { lines, totals, error } = priceItems(body.items);
  if (error) throw new ApiError(422, error, "items_unavailable");

  // A customer may only choose a payment method that is actually usable. If
  // digital payments are switched off or unconfigured, a UPI request is refused
  // here rather than accepted and then left unpayable — the customer is told to
  // choose Cash on Delivery instead.
  if (value.paymentMethod === PAYMENT_METHOD.UPI && providerForNewOrder(PAYMENT_METHOD.UPI) === null) {
    throw new ApiError(
      503,
      "Online payment is not available right now. Please choose Cash on Delivery.",
      "payments_unavailable",
    );
  }

  /**
   * One secret per order, used for two purposes: it is handed to the customer on
   * creation, and it is the token in the emailed tracking link.
   *
   * Two separate secrets would have to be rotated together, would double the number
   * of values that could leak, and would let one be used where the other was not
   * intended. One secret means a single rotation invalidates every outstanding
   * tracking link, which is the revocation story an operator wants.
   */
  const accessToken = newAccessToken();

  return {
    customerName: value.name,
    phone: value.phone,
    // Null when the customer gave none, which is normal and not an error.
    customerEmail: value.email,
    address: value.address,
    landmark: value.landmark,
    specialInstructions: value.instructions,
    // The area the customer chose, already checked against the configured list by
    // validateCheckout. `deliveryAreaName` is resolved from that list rather than
    // submitted, so it cannot be a string an attacker chose.
    deliveryArea: value.deliveryArea,
    deliveryAreaName: value.deliveryAreaName,
    // The customer's own statement that the address is correct and inside JOC's
    // area. A true boolean, always true here: an order that reached this point has
    // the confirmation, and a false one never reaches persistence at all.
    deliveryAreaConfirmed: value.deliveryAreaConfirmed,
    items: lines,
    subtotal: totals.subtotal,
    deliveryCharge: totals.deliveryCharge,
    total: totals.total,
    currency: ORDER_DEFAULTS.currency,
    paymentMethod: value.paymentMethod,
    // Which rail settles a digital payment. Null for cash on delivery. Stamped
    // server-side from configuration, never from the request body, so a client
    // cannot choose its own settlement path.
    paymentProvider: providerForNewOrder(value.paymentMethod),
    // Always PENDING at creation. Cash on delivery settles when the order is
    // delivered; a manual UPI payment moves to PAYMENT_VERIFICATION_REQUIRED when
    // the customer submits a UTR, and a gateway payment is only promoted to PAID
    // by the signature check in /api/payments/verify. The browser cannot influence
    // either.
    paymentStatus: PAYMENT_STATUS.PENDING,
    orderStatus: ORDER_STATUS.RECEIVED,
    accessToken,
    // The tracking link is built from that same secret. Stamped here rather than
    // later because there is no asynchronous delivery step between pricing and
    // persistence any more — the area was already validated as part of `value`.
    trackingToken: accessToken,
  };
}

const firstError = (errors) => Object.values(errors)[0] ?? "Please check your details.";
