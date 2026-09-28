/**
 * Best-effort rate limiting for the public ordering endpoints.
 *
 * Deliberately in-memory: it protects a single serverless instance from an
 * obvious flood and keeps a paid platform off the critical path. It is not a
 * distributed limiter, and the database remains the real backstop. Raise these
 * numbers if legitimate traffic ever trips them.
 */

const WINDOWS = new Map();

export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const entry = WINDOWS.get(key);

  if (!entry || now > entry.resetAt) {
    WINDOWS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - entry.count };
}

/** Keeps the Map from growing without bound on a long-lived instance. */
export function sweepRateLimits(now = Date.now()) {
  if (WINDOWS.size < 512) return;
  for (const [key, entry] of WINDOWS) {
    if (now > entry.resetAt) WINDOWS.delete(key);
  }
}
