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

async function request(path, { method = "GET", body, idempotencyKey, signal, headers = {} } = {}) {
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
    // `errors` is a map of field name -> message, and only `invalid_checkout`
    // produces one. Every other refusal uses `details` for context that is NOT a
    // field error (`delivery_unavailable` puts a distance and an outcome there),
    // so hydrating the form from it would paste "OUT_OF_RANGE" onto an input.
    const fieldErrors = detail?.code === "invalid_checkout" ? detail?.errors ?? null : null;
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
  // server access logs. The server also accepts `?token=` when
  // JOC_ALLOW_TOKEN_QUERY=true, but only for links that were intentionally shared.
  return request(`/api/orders/${encodeURIComponent(orderId)}`, {
    signal,
    headers: { "X-Order-Token": secret },
  });
};

/**
 * The delivery rule, without checking any address.
 *
 * Read once when the checkout opens so the form can state the rule before the
 * customer has typed anything. It comes from the same value the order route
 * enforces, which is the only way the sentence on the form cannot drift away
 * from the refusal the customer would get.
 */
export const getDeliveryConfig = async ({ signal } = {}) => {
  try {
    return await request("/api/delivery/config", { signal });
  } catch {
    // No rule known. The checkout stays usable — the order route will still
    // enforce the real limit — it just cannot preview it up front.
    return { radiusKm: null, radiusMeters: null, configured: false, rule: null };
  }
};

/**
 * Ask whether JOC can deliver to an address.
 *
 * A preview, and nothing more: the order route repeats the same check itself
 * before creating anything. `available: false` therefore means "we know you are
 * too far" OR "we could not check" — the caller shows the message either way,
 * because acting on the difference is the server's job, not the form's.
 */
export const checkDelivery = ({ address, landmark }, { signal } = {}) =>
  request("/api/delivery/check", {
    method: "POST",
    body: { address, landmark },
    signal,
  }).then((data) => data.delivery);

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

/** Stable per-attempt token so a repeat of the same submission is idempotent. */
export const newIdempotencyKey = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `joc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
