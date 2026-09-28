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

async function request(path, { method = "GET", body, idempotencyKey, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
    throw new ApiRequestError(
      detail?.message ?? "Something went wrong. Please try again.",
      { code: detail?.code ?? "server_error", status: response.status, fieldErrors: detail?.errors },
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

export const getOrder = (orderId, { signal } = {}) => {
  const token = recallToken(orderId);
  if (!token) {
    return Promise.reject(
      new ApiRequestError("We could not find that order on this device.", {
        code: "order_not_found",
        status: 404,
      }),
    );
  }
  return request(`/api/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`, {
    signal,
  }).then((data) => data.order);
};

export const startPayment = (orderId) =>
  request("/api/payments/create", { method: "POST", body: { orderId } });

export const verifyPayment = ({ orderId, gatewayOrderId, paymentId, signature }) =>
  request("/api/payments/verify", {
    method: "POST",
    body: { orderId, gatewayOrderId, paymentId, signature },
  }).then((data) => data.order);

export const abandonPayment = ({ orderId, paymentMethod }) =>
  request("/api/payments/cancel", { method: "POST", body: { orderId, paymentMethod } }).then(
    (data) => data.order,
  );

/** Stable per-attempt token so a repeat of the same submission is idempotent. */
export const newIdempotencyKey = () =>
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `joc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
