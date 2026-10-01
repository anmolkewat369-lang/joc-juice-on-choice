/**
 * Thin client for the order API.
 *
 * Every call goes through `request()` so network failure, a non-JSON response
 * and an API error all arrive as the same `ApiRequestError` with a message that
 * is safe to show a customer. Stack traces and gateway internals never reach the
 * screen.
 */

const TOKEN_PREFIX = "joc.orderToken.";

export class ApiRequestError extends Error {
  constructor(message, { code = "request_failed", status = 0, fieldErrors = null } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function request(
  path,
  { method = "GET", body, idempotencyKey, signal, headers = {} } = {},
) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiRequestError(
      "We could not reach JOC. Please check your connection and try again.",
      { code: "network_error" },
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.error;
    // `errors` is a field name -> message map when the server has precise
    // per-input feedback (checkout, and the account forms). Endpoints that only
    // have a sentence to give use `details` instead, which is never treated as a
    // field error.
    const fieldErrors = detail?.errors ?? null;
    throw new ApiRequestError(
      detail?.message ?? "Something went wrong. Please try again.",
      { code: detail?.code ?? "server_error", status: response.status, fieldErrors },
    );
  }

  return payload;
}

/* ------------------------------ order secrets ---------------------------- */

/**
 * The order access secret, kept per order id in sessionStorage. It survives a
 * refresh on the same tab, which is what lets the confirmation page reload the
 * order, and it disappears when the tab closes.
 */
export const orderTokenKey = (orderId) => `${TOKEN_PREFIX}${orderId}`;

function rememberToken(orderId, token) {
  try {
    window.sessionStorage.setItem(orderTokenKey(orderId), token);
  } catch {
    /* storage unavailable — the confirmation page falls back to in-memory state */
  }
}

function recallToken(orderId) {
  try {
    return window.sessionStorage.getItem(orderTokenKey(orderId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Adopt a token that arrived in a tracking link.
 *
 * When the customer follows the emailed `#/order/<id>?t=<token>` link, this is the
 * first time their browser has seen the order secret. Storing it in
 * sessionStorage means every later call — the poll, the payment, the UTR
 * submission — can use the header path without the token being threaded through
 * the whole component tree, and without it ever appearing in a query string.
 *
 * It is a copy into the tab, not a replacement of the server's copy: the
 * database still holds only the hash, and this is still the same secret, still
 * checked in constant time against `access_hash`.
 */
function adoptToken(orderId, token) {
  rememberToken(orderId, token);
}

/* --------------------------------- calls --------------------------------- */

export const createOrder = (payload, idempotencyKey) =>
  request("/api/orders", {
    method: "POST",
    body: payload,
    idempotencyKey,
  }).then((data) => {
    if (data.accessToken && data.order?.orderId) {
      rememberToken(data.order.orderId, data.accessToken);
    }
    return data;
  });

export const getOrder = (orderId, { signal, token } = {}) =>
  getOrderDetail(orderId, { signal, token }).then((data) => data.order);

/**
 * The order plus its payment view — the UPI ID, intent URI and QR rebuilt from
 * the total the *server* priced. Kept separate from getOrder because only the
 * confirmation screen needs the payment half, and returning the whole payload
 * everywhere would invite a caller to trust a client-side total.
 *
 * `token` lets a caller that arrived through an emailed tracking link supply the
 * secret it read from the fragment. It is stored once so subsequent polls do not
 * have to keep passing it around.
 */
export const getOrderDetail = (orderId, { signal, token } = {}) => {
  if (token) adoptToken(orderId, token);

  const secret = recallToken(orderId);
  if (!secret) {
    return Promise.reject(
      new ApiRequestError("We could not find that order on this device.", {
        code: "order_not_found",
        status: 404,
      }),
    );
  }
  // The secret travels in a header, not the query string, so it never lands in
  // server access logs or browser history.
  return request(`/api/orders/${encodeURIComponent(orderId)}`, {
    signal,
    headers: { "X-Order-Token": secret },
  });
};

/**
 * What the customer can pay with, per the server.
 *
 * The checkout renders its payment options from this rather than hard-coding
 * them, so an option that cannot actually take a payment is never shown — and a
 * newly configured rail appears without a frontend release.
 */
export const getPaymentMethods = ({ signal } = {}) =>
  request("/api/payments/methods", { signal }).then((data) => {
    const digital = data.methods.find((entry) => entry.method !== "COD") ?? null;
    return {
      provider: data.provider,
      digital,
      // The UPI ID the customer should pay, when the server is offering manual
      // UPI. It is a payment address rather than a credential, and it arrives
      // from the server so checkout can never show a stale or invented one.
      vpa: digital?.vpa ?? null,
    };
  });

/**
 * Every payment call carries the order's own secret.
 *
 * Order ids are sequential, so the server treats a bare order id as belonging to
 * anyone. Presenting the token is what proves this browser owns the order being
 * paid for, converted or verified.
 */
const withOrderToken = (orderId, headers = {}) => {
  const token = recallToken(orderId);
  if (!token) {
    throw new ApiRequestError("We could not find that order on this device.", {
      code: "order_not_found",
      status: 404,
    });
  }
  return { "X-Order-Token": token, ...headers };
};

export const startPayment = (orderId) =>
  request("/api/payments/create", {
    method: "POST",
    body: { orderId },
    headers: withOrderToken(orderId),
  });

export const verifyPayment = ({ orderId, gatewayOrderId, paymentId, signature }) =>
  request("/api/payments/verify", {
    method: "POST",
    body: { orderId, gatewayOrderId, paymentId, signature },
    headers: withOrderToken(orderId),
  }).then((data) => data.order);

export const abandonPayment = ({ orderId, paymentMethod }) =>
  request("/api/payments/cancel", {
    method: "POST",
    body: { orderId, paymentMethod },
    headers: withOrderToken(orderId),
  }).then((data) => data.order);

/**
 * Submit a UPI transaction reference.
 *
 * This records a *claim* that the money was sent. It can only ever move the order
 * to PAYMENT_VERIFICATION_REQUIRED — the server has no path here that produces
 * PAID, and only an authenticated admin can do that. The response echoes back the
 * exact text the customer should enter on the confirmation screen.
 */
export const submitUtr = ({ orderId, paymentReference }) =>
  request("/api/orders/utr", {
    method: "POST",
    body: { orderId, paymentReference },
    headers: withOrderToken(orderId),
  });

/* ------------------------------ customer account ------------------------- */

/**
 * Adopt an order secret handed to us by the My Orders list.
 *
 * The list knows the owner's tracking token because the customer API is
 * authenticated; "View Order" then navigates to the normal `#/order/<id>?t=…`
 * route, and this stores the token first so the tracking screen — and every poll
 * or payment retry after it — can use the header path exactly as if the order
 * had been placed on this device.
 */
export const adoptOrderToken = (orderId, token) => {
  if (orderId && token) adoptToken(orderId, token);
};

export const getCustomerSession = ({ signal } = {}) =>
  request("/api/customer/session", { signal });

export const customerSignup = ({ name, email, password, confirmPassword }) =>
  request("/api/customer/signup", {
    method: "POST",
    body: { name, email, password, confirmPassword },
  });

export const customerLogin = ({ email, password }) =>
  request("/api/customer/login", { method: "POST", body: { email, password } });

export const customerLogout = () => request("/api/customer/logout", { method: "DELETE" });

export const customerForgot = ({ email }) =>
  request("/api/customer/forgot", { method: "POST", body: { email } });

export const customerReset = ({ accessToken, password, confirmPassword }) =>
  request("/api/customer/reset", {
    method: "POST",
    body: { accessToken, password, confirmPassword },
  });

export const getMyOrders = ({ signal } = {}) =>
  request("/api/customer/orders", { signal }).then((data) => data.orders ?? []);

/* --------------------------------- web push ------------------------------ */

export const getPushConfig = ({ signal } = {}) =>
  request("/api/push/subscribe", { signal });

export const savePushSubscription = (subscription) =>
  request("/api/push/subscribe", {
    method: "POST",
    body: { subscription: subscription.toJSON ? subscription.toJSON() : subscription },
  });

export const removePushSubscription = (endpoint) =>
  request("/api/push/subscribe", { method: "DELETE", body: { endpoint } });

/** Stable per-attempt token so a repeat of the same submission is idempotent. */
export const newIdempotencyKey = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `joc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
