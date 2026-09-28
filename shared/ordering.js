/**
 * Shared ordering contract.
 *
 * Imported by BOTH the React frontend and the Vercel serverless functions in
 * /api. Keeping delivery rules, limits and validation here means the cart shown
 * to the customer and the total charged by the server can never drift apart.
 *
 * Plain ES module, no framework imports — safe in the browser and in Node.
 *
 * ----------------------------------------------------------------------------
 * DELIVERY PRICING IS A PLACEHOLDER
 * JOC has not supplied a final delivery policy. Everything below is a single
 * editable value; nothing on the site claims "free delivery".
 * ----------------------------------------------------------------------------
 */

/** Flat rupee amount added to every order. Set to 0 to disable. */
export const DELIVERY_CHARGE = 20;

/** Optional free-delivery threshold in rupees. 0 disables the rule. */
export const FREE_DELIVERY_ABOVE = 0;

/** Shown to the customer next to the charge. Kept factual on purpose. */
export const DELIVERY_LABEL = "Delivery charge";

/**
 * Placeholder wording. Replace with JOC's real policy before launch.
 * Kept short and honest — it does not promise anything the client has not said.
 */
export const DELIVERY_NOTE =
  "Flat delivery charge. Final delivery pricing to be confirmed by JOC.";

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
};

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

/** Forward-only lifecycle. A future admin panel walks an order along this list. */
export const ORDER_STATUS_FLOW = [
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
];

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

export const PAYMENT_METHOD = {
  COD: "COD",
  ONLINE: "ONLINE",
};

export const PAYMENT_METHOD_LABELS = {
  [PAYMENT_METHOD.COD]: "Cash on Delivery",
  [PAYMENT_METHOD.ONLINE]: "Paid Online",
};

/**
 * How an online order was actually settled. `razorpay_test` means a test
 * gateway key was used and no real money moved — the confirmation screen must
 * say so plainly, because the customer chose a payment method, not a sandbox.
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
  address: "Please enter your delivery address.",
  paymentMethod: "Please choose a payment method.",
  cart: "Your cart is empty.",
  item: "One of the items in your cart is no longer available. Please review your cart.",
};

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

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
 */
export function validateCheckout(input, { requireItems = true } = {}) {
  const errors = {};
  const name = cleanText(input?.name, LIMITS.name);
  const phone = normalisePhone(input?.phone);
  const address = cleanText(input?.address, LIMITS.address);
  const landmark = cleanText(input?.landmark, LIMITS.landmark);
  const instructions = cleanText(input?.instructions, LIMITS.instructions);
  const method = input?.paymentMethod;

  if (name.length < 2 || !NAME_RE.test(name)) errors.name = VALIDATION_MESSAGES.name;
  if (!phone) errors.phone = VALIDATION_MESSAGES.phone;
  if (address.length < 8) errors.address = VALIDATION_MESSAGES.address;
  if (method !== PAYMENT_METHOD.COD && method !== PAYMENT_METHOD.ONLINE) {
    errors.paymentMethod = VALIDATION_MESSAGES.paymentMethod;
  }
  if (requireItems && (!Array.isArray(input?.items) || input.items.length === 0)) {
    errors.cart = VALIDATION_MESSAGES.cart;
  }

  return {
    errors,
    valid: Object.keys(errors).length === 0,
    value: Object.keys(errors).length === 0
      ? { name, phone, address, landmark, instructions, paymentMethod: method }
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
