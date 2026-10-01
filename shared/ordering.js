/**
 * Shared ordering contract.
 *
 * Imported by BOTH the React frontend and the Vercel serverless functions in
 * /api. Keeping delivery rules, limits and validation here means the cart shown
 * to the customer and the total charged by the server can never drift apart.
 *
 * Plain ES module, no framework imports — safe in the browser and in Node.
 *
 * The delivery AREA rule and its wording come from shared/delivery.js, which reads
 * the configured list in src/data/deliveryAreas.js. There is no coordinate or
 * measured distance involved anywhere: the customer picks an area and confirms
 * their address, and JOC confirms the rest.
 *
 * ----------------------------------------------------------------------------
 * DELIVERY PRICING IS NOT SET
 * JOC has not supplied a delivery policy, so the site does not invent one. The
 * server-authoritative total is `subtotal + DELIVERY_CHARGE`, and DELIVERY_CHARGE
 * is 0. Customers are told the charge is "To be confirmed" rather than being
 * shown a made-up fee. When JOC confirms a real policy, change
 * DELIVERY_CHARGE (and optionally FREE_DELIVERY_ABOVE) here — the cart, the
 * checkout, the confirmation screen and the server all pick it up at once.
 * ----------------------------------------------------------------------------
 */

import {
  DELIVERY_AREA_CONFIRM_REQUIRED,
  DELIVERY_AREA_REQUIRED,
  validateDeliveryArea,
} from "./delivery.js";

/** Flat rupee amount added to every order. 0 = no charge is applied. */
export const DELIVERY_CHARGE = 0;

/** Optional free-delivery threshold in rupees. 0 disables the rule. */
export const FREE_DELIVERY_ABOVE = 0;

/** Shown to the customer next to the charge. Kept factual on purpose. */
export const DELIVERY_LABEL = "Delivery charge";

/**
 * What the customer actually sees in place of an amount, because no amount has
 * been confirmed. Never render "Free" for a charge that has not been decided —
 * that would be a claim JOC has not made.
 */
export const DELIVERY_PENDING_LABEL = "To be confirmed";

export const DELIVERY_NOTE = "Delivery charge will be confirmed separately by JOC.";

export const CURRENCY = "INR";

/** Guard rails against an accidental or abusive huge order. */
export const MAX_QTY_PER_ITEM = 20;
export const MAX_DISTINCT_ITEMS = 25;

/** Hard cap on any single text field the customer can send. */
export const LIMITS = {
  name: 80,
  address: 400,
  landmark: 80,
  instructions: 300,
  phone: 15,
  /**
   * 254 is the longest address SMTP will accept. It is a cap on what we are
   * willing to store and mail, not a claim that every address under it is real.
   */
  email: 254,
};

/**
 * Email is OPTIONAL, and that is a deliberate business decision.
 *
 * JOC already reaches the customer on the phone number they gave, so requiring an
 * address would collect personal data that the order does not need. The address
 * exists for one purpose only: so JOC can send order updates and a secure
 * tracking link to a customer who wants them. Blank is always valid, on the
 * client and on the server, and a customer who leaves it empty still orders
 * exactly as before.
 */
export const EMAIL_OPTIONAL_NOTE =
  "Optional. We use it only to send your order updates and tracking link. We never share it.";

/* ------------------------------ Order states ------------------------------ */

export const ORDER_STATUS = {
  RECEIVED: "RECEIVED",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

/** Forward-only lifecycle. The admin dashboard walks an order along this list. */
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

/**
 * Which order statuses may follow which.
 *
 * CANCELLED is reachable from any state that has not been handed to the
 * customer yet, and nothing is reachable *from* CANCELLED or DELIVERED — a
 * finished order is finished. Keeping the map here (rather than in the admin
 * handler) means the same rule is testable without a database and identical
 * everywhere it is enforced.
 */
export const ORDER_STATUS_TRANSITIONS = {
  [ORDER_STATUS.RECEIVED]: [
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.CONFIRMED]: [
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.PREPARING]: [
    ORDER_STATUS.READY,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.READY]: [
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
};

export const isOrderStatus = (value) =>
  typeof value === "string" && value in ORDER_STATUS_TRANSITIONS;

/** Can an order legally move from `from` to `to`? Terminal states never move. */
export function canTransitionOrderStatus(from, to) {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Plain-English status names, shared by the customer screens and the admin UI. */
export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.RECEIVED]: "Received",
  [ORDER_STATUS.CONFIRMED]: "Confirmed",
  [ORDER_STATUS.PREPARING]: "Preparing",
  [ORDER_STATUS.READY]: "Ready",
  [ORDER_STATUS.OUT_FOR_DELIVERY]: "Out for delivery",
  [ORDER_STATUS.DELIVERED]: "Delivered",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
};

/**
 * Payment states.
 *
 * PAYMENT_VERIFICATION_REQUIRED exists because a customer telling us they paid
 * is a *claim*, not proof. A manual UPI payment sits in that state until an
 * authenticated admin confirms the money actually arrived. Nothing in the
 * customer-facing code path may move an order to PAID.
 */
export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  PAYMENT_VERIFICATION_REQUIRED: "PAYMENT_VERIFICATION_REQUIRED",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

export const PAYMENT_STATUS_LABELS = {
  [PAYMENT_STATUS.PENDING]: "Pending",
  [PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED]: "Verification required",
  [PAYMENT_STATUS.PAID]: "Paid",
  [PAYMENT_STATUS.FAILED]: "Not completed",
  [PAYMENT_STATUS.REFUNDED]: "Refunded",
};

/** States an admin should look at first, rendered with a visual warning. */
export const ATTENTION_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED,
]);

export const PAYMENT_METHOD = {
  COD: "COD",
  UPI: "UPI",
};

export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD);

export const isPaymentMethod = (value) => PAYMENT_METHOD_VALUES.includes(value);

export const PAYMENT_METHOD_LABELS = {
  [PAYMENT_METHOD.COD]: "Cash on Delivery",
  [PAYMENT_METHOD.UPI]: "UPI",
};

/**
 * Which rail settles the payment, stored as `payment_provider` and kept separate
 * from `payment_method` so switching settlement rails later does not require
 * touching what the customer chose.
 *
 *   cod         — no rail. Cash handed to the delivery partner on arrival. A
 *                 label, not a configuration: it is always available and needs
 *                 no account, credential or UPI ID.
 *   manual_upi  — customer paid to a UPI ID on their own; verified by an admin.
 *   razorpay    — customer paid through Razorpay Checkout; verified by signature.
 */
export const PAYMENT_PROVIDER = {
  COD: "cod",
  MANUAL_UPI: "manual_upi",
  RAZORPAY: "razorpay",
};

export const PAYMENT_PROVIDER_LABELS = {
  [PAYMENT_PROVIDER.COD]: "Cash on Delivery",
  [PAYMENT_PROVIDER.MANUAL_UPI]: "Manual UPI (verified by JOC)",
  [PAYMENT_PROVIDER.RAZORPAY]: "Razorpay",
  razorpay_test: "Razorpay (TEST — no real money was charged)",
};

/**
 * How a settled order was paid, as shown to the customer. A test-mode gateway
 * payment says so plainly, because the customer picked a payment method, not a
 * sandbox.
 */
export const PAYMENT_METHOD_USED_LABELS = {
  razorpay: "Paid Online",
  razorpay_test: "Paid Online (TEST — no real money was charged)",
};


/* -------------------------------- Pricing -------------------------------- */

/** Rupees, minor units, integers only — no paise handling needed. */
export function deliveryChargeFor(subtotal) {
  if (FREE_DELIVERY_ABOVE > 0 && subtotal >= FREE_DELIVERY_ABOVE) return 0;
  return DELIVERY_CHARGE;
}

export function totalsFor(subtotal) {
  const deliveryCharge = deliveryChargeFor(subtotal);
  return { subtotal, deliveryCharge, total: subtotal + deliveryCharge };
}

/**
 * The delivery line as the customer sees it. A zero charge means "not decided
 * yet", not "free", so it is never rendered as ₹0 or "Free".
 */
export function deliveryAmountLabel(deliveryCharge, formatAmount) {
  return deliveryCharge > 0 ? formatAmount(deliveryCharge) : DELIVERY_PENDING_LABEL;
}


/* ------------------------------ Order identity ---------------------------- */

/** Human-readable order reference, e.g. JOC-20260928-0001. */
export const formatOrderId = (date, sequence) =>
  `JOC-${yyyymmdd(date)}-${String(sequence).padStart(4, "0")}`;

function yyyymmdd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/* -------------------------------- Validation ------------------------------ */

export const VALIDATION_MESSAGES = {
  name: "Please enter your name.",
  phone: "Please enter a valid 10-digit mobile number.",
  email: "Please enter a valid email address, or leave it empty.",
  address: "Please enter your delivery address.",
  paymentMethod: "Please choose a payment method.",
  cart: "Your cart is empty.",
  item: "One of the items in your cart is no longer available. Please review your cart.",
  // The delivery area rules and their wording live in shared/delivery.js, so the
  // checkout, the server and the tests cannot end up with three different sentences.
  deliveryArea: DELIVERY_AREA_REQUIRED,
  deliveryAreaConfirmed: DELIVERY_AREA_CONFIRM_REQUIRED,
};

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

/**
 * A deliberately conservative address shape.
 *
 * It is not an attempt to prove an address exists — nothing on this screen can do
 * that. It only rejects input that could never be delivered to: no "@", spaces,
 * no TLD, or a stray newline. Anything it accepts is stored and escaped; nothing
 * it rejects is ever used as a mail target.
 */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Normalise an email address, or return null when it is unusable.
 *
 * An empty or whitespace-only value is NOT an error: it means the customer
 * declined to give one. Only a non-empty value that fails EMAIL_RE is rejected,
 * so a half-typed address is caught early rather than silently discarded.
 */
export function normaliseEmail(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/g, "");
  if (value.length === 0) return null;
  if (value.length > LIMITS.email) return undefined;
  return EMAIL_RE.test(value) ? value.toLowerCase() : undefined;
}

/** Indian mobile numbers: 10 digits starting 6-9. Accepts +91 / 0 prefixes. */
export function normalisePhone(raw) {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d]/g, "");
  const national =
    digits.length > 10 && digits.endsWith(digits.slice(-10)) ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(national)) return null;
  return `+91${national}`;
}

function cleanText(raw, max) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Validate a checkout payload. Returns a field-keyed error map; an empty object
 * means valid. Identical rules run on the client (inline messages) and on the
 * server (the one that actually matters).
 *
 * The delivery area and its acknowledgement are validated here, by
 * `validateDeliveryArea`, rather than inline below. They are a separate contract
 * with their own wording and their own list, and folding them into this function
 * would be how the checkout and the server ended up disagreeing about whether an
 * area is acceptable.
 *
 * Every bad field is reported at once. A customer who has not chosen an area and
 * has not ticked the box should see both problems at the first submit, not
 * discover the second one after fixing the first.
 */
export function validateCheckout(input, { requireItems = true } = {}) {
  const errors = {};
  const name = cleanText(input?.name, LIMITS.name);
  const phone = normalisePhone(input?.phone);
  const address = cleanText(input?.address, LIMITS.address);
  const landmark = cleanText(input?.landmark, LIMITS.landmark);
  const instructions = cleanText(input?.instructions, LIMITS.instructions);
  const method = input?.paymentMethod;
  // null = the customer gave none (valid). undefined = they gave one that cannot
  // be used. Both are folded into the single `email` field below.
  const email = normaliseEmail(input?.email);

  if (name.length < 2 || !NAME_RE.test(name)) errors.name = VALIDATION_MESSAGES.name;
  if (!phone) errors.phone = VALIDATION_MESSAGES.phone;
  if (email === undefined) errors.email = VALIDATION_MESSAGES.email;
  if (address.length < 8) errors.address = VALIDATION_MESSAGES.address;
  if (!isPaymentMethod(method)) {
    errors.paymentMethod = VALIDATION_MESSAGES.paymentMethod;
  }
  if (requireItems && (!Array.isArray(input?.items) || input.items.length === 0)) {
    errors.cart = VALIDATION_MESSAGES.cart;
  }

  // The area and the confirmation. Merged in rather than short-circuited, so one
  // refusal never hides the others.
  const deliveryArea = validateDeliveryArea(input);
  Object.assign(errors, deliveryArea.errors);

  const valid = Object.keys(errors).length === 0;

  return {
    errors,
    valid,
    value: valid
      ? {
          name,
          phone,
          email: email ?? null,
          address,
          landmark,
          instructions,
          paymentMethod: method,
          // Normalised id from the configured list, plus the label resolved from
          // that same list. Neither comes from the request body as a display
          // string, so a tampered payload cannot invent an area name that reaches
          // the admin dashboard or an email.
          deliveryArea: deliveryArea.value.area,
          deliveryAreaName: deliveryArea.value.areaName,
          // A real boolean on the record, so an order row can never carry the
          // string "false" and be read as confirmed.
          deliveryAreaConfirmed: deliveryArea.value.confirmed,
        }
      : null,
  };
}

/** Shape + bounds for the raw { items } list, independent of customer fields. */
export function normaliseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { items: [], error: VALIDATION_MESSAGES.cart };
  }
  if (rawItems.length > MAX_DISTINCT_ITEMS) {
    return { items: [], error: "Too many different items in one order." };
  }

  const merged = new Map();
  for (const entry of rawItems) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const qty = Number(entry?.qty);
    if (!Number.isInteger(qty) || qty < 1) continue;
    // Clamp rather than reject: a customer nudging the stepper should never
    // lose their cart to a validation error.
    const next = Math.min(qty, MAX_QTY_PER_ITEM) + (merged.get(id) ?? 0);
    merged.set(id, Math.min(next, MAX_QTY_PER_ITEM));
  }

  if (merged.size === 0) return { items: [], error: VALIDATION_MESSAGES.cart };
  return { items: [...merged].map(([id, qty]) => ({ id, qty })), error: null };
}

/* ---------------------- Customer-facing payment states -------------------- */

/**
 * What the customer is told, and whether they still owe us an action.
 *
 * This is the single source of truth for the confirmation screen, so "paid" can
 * never be displayed before `payment_status` is actually PAID. Note there is
 * deliberately no "Payment successful" state reachable from a customer action:
 * PAID is only ever set by an authenticated admin (manual UPI) or by verified
 * gateway signature (Razorpay).
 */
export const CUSTOMER_PAYMENT_STATE = {
  ORDER_RECEIVED: "ORDER_RECEIVED",
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  VERIFICATION_REQUIRED: "VERIFICATION_REQUIRED",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const CUSTOMER_PAYMENT_COPY = {
  [CUSTOMER_PAYMENT_STATE.ORDER_RECEIVED]: {
    title: "Order received",
    lead: "Thank you for ordering from JOC. We will prepare your order shortly.",
  },
  [CUSTOMER_PAYMENT_STATE.AWAITING_PAYMENT]: {
    title: "Payment pending",
    lead: "Pay using UPI, then enter your UTR / transaction ID so we can match the payment.",
  },
  [CUSTOMER_PAYMENT_STATE.VERIFICATION_REQUIRED]: {
    title: "Payment verification required",
    lead:
      "We have your UTR. JOC will check it against our bank/UPI records and confirm your payment.",
  },
  [CUSTOMER_PAYMENT_STATE.VERIFIED]: {
    title: "Payment verified",
    lead: "JOC has confirmed your payment. We are preparing your order now.",
  },
  [CUSTOMER_PAYMENT_STATE.FAILED]: {
    title: "Payment could not be completed",
    lead:
      "Your payment was not confirmed, so nothing has been recorded as paid. Your order is saved.",
  },
  [CUSTOMER_PAYMENT_STATE.CANCELLED]: {
    title: "Order cancelled",
    lead: "This order was cancelled. Please place a new order if you still would like to order.",
  },
};

/** Pure function of the server's own order row — no browser state involved. */
export function customerPaymentState(order) {
  if (!order) return CUSTOMER_PAYMENT_STATE.FAILED;
  if (order.orderStatus === ORDER_STATUS.CANCELLED) {
    return CUSTOMER_PAYMENT_STATE.CANCELLED;
  }
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    return CUSTOMER_PAYMENT_STATE.VERIFIED;
  }
  if (order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED) {
    return CUSTOMER_PAYMENT_STATE.VERIFICATION_REQUIRED;
  }
  if (order.paymentStatus === PAYMENT_STATUS.FAILED) {
    return CUSTOMER_PAYMENT_STATE.FAILED;
  }
  // PENDING: cash on delivery is complete as far as ordering goes; a digital
  // payment still needs the customer to act.
  if (order.paymentMethod === PAYMENT_METHOD.COD) {
    return CUSTOMER_PAYMENT_STATE.ORDER_RECEIVED;
  }
  return CUSTOMER_PAYMENT_STATE.AWAITING_PAYMENT;
}

export function customerPaymentCopy(order) {
  const state = customerPaymentState(order);
  return { state, ...CUSTOMER_PAYMENT_COPY[state] };
}

/** True while the customer still has to pay and enter a UTR. */
export const isAwaitingUtr = (order) =>
  customerPaymentState(order) === CUSTOMER_PAYMENT_STATE.AWAITING_PAYMENT;

/* ------------------------- UPI reference validation ---------------------- */

/**
 * A UTR / transaction reference is whatever the customer's bank or UPI app
 * showed them: 12-digit UTRs are most common, but UPI apps also display
 * alphanumeric reference numbers. Accept both, reject everything else, and never
 * store a string that could be interpreted as markup or SQL.
 */
export const UTR_MIN_LENGTH = 6;
export const UTR_MAX_LENGTH = 64;
const UTR_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{5,63}$/;

export function normalisePaymentReference(raw) {
  if (typeof raw !== "string") return { value: null, error: UTR_MESSAGES.invalid };
  const value = raw.trim().replace(/\s+/g, "");
  if (value.length < UTR_MIN_LENGTH) return { value: null, error: UTR_MESSAGES.invalid };
  if (value.length > UTR_MAX_LENGTH) return { value: null, error: UTR_MESSAGES.tooLong };
  if (!UTR_RE.test(value)) return { value: null, error: UTR_MESSAGES.invalid };
  return { value, error: null };
}

export const UTR_MESSAGES = {
  invalid: "Please enter the UTR / transaction reference exactly as your UPI app showed it.",
  tooLong: "That reference is too long. Please check and re-enter it.",
  missing: "Please enter your UTR / transaction reference.",
};
