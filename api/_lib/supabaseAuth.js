/**
 * Supabase Auth — the one place server code talks to GoTrue.
 *
 * There is deliberately no `@supabase/supabase-js` dependency: the endpoints
 * this project needs are a handful of documented HTTPS calls, so the transport
 * is plain `fetch` and the surface stays obvious. Admin auth and customer auth
 * both sit on top of this module, which means there is exactly one place that
 * knows how to reach Supabase, and exactly one place that could ever be tricked
 * into mishandling a password.
 *
 * NOTHING here stores a password or a hash. A password is forwarded to Supabase
 * over TLS and then dropped; the customer's session is the signed httpOnly
 * cookie minted by customerAuth.js, never a Supabase access token handed to the
 * browser.
 */

import { ApiError } from "./http.js";

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/** Trailing slashes removed so a configured URL with one cannot double up. */
export const supabaseUrl = () => env("SUPABASE_URL").replace(/\/+$/, "");
export const supabaseAnonKey = () => env("SUPABASE_ANON_KEY");

/** True only when Supabase Auth is reachable-ready: URL and anon key present. */
export const isSupabaseConfigured = () =>
  Boolean(supabaseUrl() && supabaseAnonKey());

const notConfigured = () =>
  new ApiError(
    503,
    "Sign-in is not configured on this server.",
    "auth_not_configured",
  );

const unreachable = () =>
  new ApiError(
    503,
    "Could not reach the sign-in service. Please try again in a moment.",
    "auth_unavailable",
  );

/**
 * One HTTP helper for every GoTrue call.
 *
 * Returns `{ ok, status, payload }` instead of throwing on a provider refusal,
 * because each caller needs to decide what a refusal means: a wrong password is
 * a 401 for the customer, while an unconfirmed email during sign-up is not an
 * error at all. Only a network failure or missing configuration throws, since
 * neither can be interpreted.
 */
async function goTrue(path, { method = "POST", body, accessToken } = {}) {
  if (!isSupabaseConfigured()) throw notConfigured();

  let response;
  try {
    response = await fetch(`${supabaseUrl()}${path}`, {
      method,
      headers: {
        apikey: supabaseAnonKey(),
        Authorization: `Bearer ${accessToken || supabaseAnonKey()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A Supabase outage must never be reported as a wrong password.
    throw unreachable();
  }

  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

const firstMessage = (payload) =>
  payload?.msg || payload?.error_description || payload?.error || null;

/* ------------------------------- password grant --------------------------- */

/**
 * Exchange an email + password for the Supabase user.
 *
 * The success shape is intentionally tiny: an id and an email. The access and
 * refresh tokens GoTrue returns are NOT surfaced past this function — this
 * project issues its own session cookie and has no use for a Supabase token in
 * the browser. A role or metadata claim is never trusted for authorisation.
 */
export async function passwordGrant({ email, password }) {
  const { ok, payload } = await goTrue("/auth/v1/token?grant_type=password", {
    body: { email, password },
  });
  if (!ok) {
    // One generic refusal for every GoTrue failure, so a probe cannot tell a
    // wrong password from a non-existent account from an unconfirmed email.
    throw new ApiError(
      401,
      "Those sign-in details were not accepted.",
      "invalid_credentials",
    );
  }
  const id = payload?.user?.id;
  const address = payload?.user?.email;
  if (!id || !address) {
    throw new ApiError(
      401,
      "Those sign-in details were not accepted.",
      "invalid_credentials",
    );
  }
  return { id, email: address };
}

/* --------------------------------- sign-up -------------------------------- */

/**
 * Create a Supabase account.
 *
 * `emailRedirectTo` is where GoTrue sends the customer after they confirm their
 * address, when confirmation is enabled on the project. Returning the user id
 * lets a project that does NOT require confirmation sign the customer straight
 * in; when confirmation IS required, `session` is null and the caller tells the
 * customer to check their inbox.
 */
export async function signUp({ email, password, data = {}, emailRedirectTo }) {
  const query = emailRedirectTo
    ? `?redirect_to=${encodeURIComponent(emailRedirectTo)}`
    : "";
  const { ok, status, payload } = await goTrue(`/auth/v1/signup${query}`, {
    body: { email, password, data },
  });

  if (!ok) {
    // A duplicate address is the one refusal worth distinguishing, because
    // "you already have an account" is actionable where a generic failure is
    // not. Everything else stays generic.
    const message = String(firstMessage(payload) ?? "").toLowerCase();
    const duplicate =
      status === 422 ||
      message.includes("already") ||
      message.includes("registered") ||
      message.includes("exists");
    throw new ApiError(
      duplicate ? 409 : 400,
      duplicate
        ? "An account with that email already exists. Try logging in instead."
        : "We could not create that account. Please check your details and try again.",
      duplicate ? "email_taken" : "signup_failed",
    );
  }

  const id = payload?.user?.id ?? null;
  const address = payload?.user?.email ?? email;
  // GoTrue returns a session for an auto-confirmed account; confirmation-on
  // returns `user` with no session.
  const accessToken = payload?.access_token ?? null;
  return { id, email: address, accessToken, session: Boolean(payload?.access_token) };
}

/* ----------------------------- password recovery --------------------------- */

/**
 * Ask GoTrue to email a recovery link.
 *
 * Always resolves, whether or not the address exists — GoTrue answers 200 for
 * an unknown address on purpose, so this endpoint cannot be used to discover
 * which emails have accounts. The caller shows the same "if that address has an
 * account…" copy either way.
 */
export async function requestPasswordReset({ email, redirectTo }) {
  const query = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
  const { ok, payload } = await goTrue(`/auth/v1/recover${query}`, {
    body: { email },
  });
  if (ok) return { requested: true };
  // A rate limit is worth surfacing so the customer waits rather than retrying.
  if (payload?.code === "over_email_send_rate_limit" || payload?.status === 429) {
    throw new ApiError(
      429,
      "We have already sent a reset email. Please wait a moment before trying again.",
      "recovery_rate_limited",
    );
  }
  return { requested: true };
}

/**
 * Set a new password using the recovery access token from the email link.
 *
 * The token arrives in the URL fragment of the reset page and is passed to the
 * server in the request body (never logged as a query string). GoTrue validates
 * it; on success the password is changed and the caller sends the customer back
 * to the login screen.
 */
export async function updatePassword({ accessToken, password }) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new ApiError(
      400,
      "That reset link is missing or has expired. Please request a new one.",
      "recovery_token_missing",
    );
  }
  const { ok, payload } = await goTrue("/auth/v1/user", {
    method: "PUT",
    accessToken,
    body: { password },
  });
  if (!ok) {
    throw new ApiError(
      400,
      "That reset link has expired or is no longer valid. Please request a new one.",
      "recovery_failed",
    );
  }
  return { id: payload?.id ?? null, email: payload?.email ?? null };
}
