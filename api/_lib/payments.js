/**
 * Payment provider abstraction.
 *
 * The checkout and order layers ask "is a digital payment available, and what
 * should I show the customer?" — never "how do I talk to Razorpay?". The
 * provider is selected by JOC_PAYMENT_PROVIDER and nothing else in the codebase
 * branches on a provider name except the provider modules themselves.
 *
 *   cod          customer pays the delivery partner in cash. Always available,
 *                          needs no configuration, and is never switched off.
 *   manual_upi  (default)  customer pays a UPI ID themselves, submits a UTR,
 *                          an admin verifies it. No gateway, no secrets.
 *   razorpay                customer pays through Razorpay Checkout. Available
 *                          only when valid credentials are configured.
 *
 * Razorpay is a *future* rail. While JOC_PAYMENT_PROVIDER=manual_upi it is not
 * offered to customers at all, and with no credentials it cannot be selected.
 * A payment option that cannot actually work is never shown.
 */

import { PAYMENT_METHOD, PAYMENT_PROVIDER, CURRENCY } from "../../shared/ordering.js";
import { hasRazorpayCredentials, isTestMode } from "./razorpay.js";
import { buildUpiIntent, isUpiConfigured, normaliseUpiId } from "./upi.js";
import { ApiError } from "./http.js";

/** The provider JOC has chosen. Anything unrecognised falls back to manual UPI. */
export function activeProvider() {
  const configured = String(process.env.JOC_PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (configured === PAYMENT_PROVIDER.RAZORPAY) return PAYMENT_PROVIDER.RAZORPAY;
  return PAYMENT_PROVIDER.MANUAL_UPI;
}

/**
 * The configured UPI ID, normalised, or null when it is absent or malformed.
 *
 * Read through one function so the value the checkout advertises, the value
 * embedded in the payment QR and the value a payment is credited to can never
 * disagree with each other.
 */
export const configuredUpiId = () => {
  const upiId = normaliseUpiId(process.env.JOC_UPI_ID);
  return isUpiConfigured(upiId) ? upiId : null;
};

/** Why a provider cannot be used right now, or null if it can. */
function unavailableReason(provider) {
  if (provider === PAYMENT_PROVIDER.RAZORPAY) {
    if (!hasRazorpayCredentials()) return "razorpay_not_configured";
    return null;
  }
  if (provider === PAYMENT_PROVIDER.MANUAL_UPI) {
    if (!configuredUpiId()) return "upi_not_configured";
    return null;
  }
  return "unknown_provider";
}

/** A provider is usable only when it is selected *and* it is configured. */
export function isProviderAvailable(provider) {
  return provider === activeProvider() && unavailableReason(provider) === null;
}

/**
 * What the checkout screen should offer.
 *
 * Cash on delivery is always available. A digital payment is offered only when
 * a provider is genuinely usable, so the customer is never shown an option that
 * cannot complete.
 */
export function availableMethods() {
  const methods = [
    {
      method: PAYMENT_METHOD.COD,
      label: "Cash on Delivery",
      available: true,
    },
  ];

  const provider = activeProvider();
  if (isProviderAvailable(provider)) {
    if (provider === PAYMENT_PROVIDER.RAZORPAY) {
      methods.push({
        method: PAYMENT_METHOD.UPI,
        provider: PAYMENT_PROVIDER.RAZORPAY,
        label: "Pay Now",
        note: "UPI • Cards • Net Banking",
        available: true,
        testMode: isTestMode(),
      });
    } else {
      methods.push({
        method: PAYMENT_METHOD.UPI,
        provider: PAYMENT_PROVIDER.MANUAL_UPI,
        label: "UPI",
        note: "Pay to our UPI ID, then enter the UTR so we can confirm it.",
        available: true,
        /**
         * The UPI ID, published here on purpose: it is a payment address, not a
         * credential, and the customer has to read it off this screen. Only ever
         * non-null when isProviderAvailable() has already confirmed a valid ID is
         * configured, so it cannot leak an unconfigured or malformed value.
         */
        vpa: configuredUpiId(),
      });
    }

  }

  return methods;
}

/** True when a digital payment can be offered at all. */
export const isDigitalPaymentAvailable = () =>
  availableMethods().some((entry) => entry.method === PAYMENT_METHOD.UPI);

/**
 * The provider stamped on a newly created order.
 *
 * Cash on delivery is recorded as the "cod" provider so every order carries a
 * provider rather than a null: it makes the value the admin dashboard shows
 * unconditional, and it is a label, not a settlement path — nothing about cash
 * on delivery is configured or switched on.
 *
 * A digital payment is stamped with the *active* provider and only when that
 * provider is genuinely usable; otherwise null, which the order layer refuses.
 */
export function providerForNewOrder(paymentMethod) {
  if (paymentMethod !== PAYMENT_METHOD.UPI) return PAYMENT_PROVIDER.COD;
  const provider = activeProvider();
  if (!isProviderAvailable(provider)) return null;
  return provider === PAYMENT_PROVIDER.RAZORPAY
    ? PAYMENT_PROVIDER.RAZORPAY
    : PAYMENT_PROVIDER.MANUAL_UPI;
}

/**
 * Public, customer-safe description of a digital payment for the given order.
 *
 * Returned with the order so the confirmation screen can render the exact
 * amount, the UPI ID, a QR and a deep link — all derived from the server's
 * stored total. Returns null for cash on delivery and for a digital order whose
 * provider is not usable, so the UI has exactly one honest answer to render.
 */
export function paymentViewFor(order) {
  if (!order || order.payment_method !== PAYMENT_METHOD.UPI) return null;

  const provider = order.payment_provider ?? activeProvider();
  if (provider === PAYMENT_PROVIDER.MANUAL_UPI) {
    const upiId = configuredUpiId();
    if (!upiId) return null;
    const intent = buildUpiIntent({
      upiId,
      amount: order.total,
      orderId: order.order_id,
      currency: order.currency ?? CURRENCY,
    });
    return {
      provider: PAYMENT_PROVIDER.MANUAL_UPI,
      mode: "manual",
      requiresUtr: true,
      ...intent,
    };
  }

  if (provider === PAYMENT_PROVIDER.RAZORPAY) {
    // The browser drives Razorpay Checkout itself; it needs no intent object,
    // only the amount the server priced.
    return {
      provider: PAYMENT_PROVIDER.RAZORPAY,
      mode: "gateway",
      requiresUtr: false,
      amount: order.total,
      currency: order.currency ?? CURRENCY,
      orderId: order.order_id,
    };
  }

  return null;
}

/** Throws a customer-safe 503 when a digital payment is not actually possible. */
export function requireProviderAvailable(provider) {
  if (isProviderAvailable(provider)) return;
  throw new ApiError(
    503,
    "Online payment is not available right now. Please choose Cash on Delivery.",
    "payments_unavailable",
  );
}
