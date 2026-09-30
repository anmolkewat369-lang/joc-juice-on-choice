/**
 * Small HTTP helpers for the Vercel serverless functions.
 * Keeps every route consistent: JSON in, JSON out, no stack traces leaked.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
  "Access-Control-Max-Age": "86400",
};

/**
 * Customer-safe message. Internal detail goes to the log, never to the browser.
 *
 * Two narrow, explicitly safe exceptions, and they are kept apart on purpose:
 *
 *   * `details` — context a client genuinely needs to react to, but which is NOT
 *     per-field: which delivery outcome came back, what the radius is. Only ever
 *     serialised for 4xx, because a 5xx here means the server is confused and its
 *     own explanation is not something to hand out.
 *   * `errors`  — a field name -> message map, which the checkout uses to mark the
 *     exact inputs a customer got wrong. Never used for anything else.
 */
export class ApiError extends Error {
  constructor(status, message, code = "request_failed", details = null, errors = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.errors = errors;
  }
}

export function methodGuard(req, res, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  res.setHeader("Allow", methods.join(", "));

  if (req.method === "OPTIONS") {
    Object.entries(CORS).forEach(([key, value]) => res.setHeader(key, value));
    res.status(204).end();
    return false;
  }
  if (!methods.includes(req.method)) {
    sendError(res, new ApiError(405, "Method not allowed.", "method_not_allowed"));
    return false;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return true;
}

export function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export function sendError(res, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : "server_error";
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong on our side. Please try again.";

  if (status >= 500) {
    // Server-side only. Never log customer PII, only the error itself.
    console.error("[joc-api]", error?.name ?? "Error", error?.message ?? error);
  }

  Object.entries(CORS).forEach(([key, value]) => res.setHeader(key, value));
  res.status(status).json({
    error: {
      code,
      message,
      // Client-actionable payload only, and only for a considered refusal. A 5xx
      // never carries any.
      ...(status < 500 && error?.details ? { details: error.details } : {}),
      ...(status < 500 && error?.errors ? { errors: error.errors } : {}),
    },
  });
}

/** Parse a JSON body defensively — an empty or malformed body is not a crash. */
export async function readJson(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        throw new ApiError(400, "Invalid request body.", "invalid_body");
      }
    }
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Invalid request body.", "invalid_body");
  }
}

export function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(ip ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
}
