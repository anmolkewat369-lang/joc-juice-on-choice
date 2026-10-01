/**
 * Customer account API — one handler, several actions.
 *
 *   GET    /api/customer/session   "am I signed in, and as whom?"
 *   POST   /api/customer/signup    create a Supabase account, then sign in
 *   POST   /api/customer/login     sign in with Supabase Auth
 *   DELETE /api/customer/logout    clear the session cookie
 *   POST   /api/customer/forgot    email a Supabase password-reset link
 *   POST   /api/customer/reset     set a new password from that link
 *   GET    /api/customer/orders    the signed-in customer's own orders
 *
 * This lives in ONE serverless function deliberately: the Vercel Hobby plan
 * caps a deployment at 12 functions, and every action here shares the same
 * session, rate-limiter and store setup, so splitting them would cost budget for
 * no separation. The route is still REST-shaped — the URL names the action.
 *
 * NOTHING here trusts the browser. The customer identity always comes from the
 * signed httpOnly cookie via `requireCustomer`; an id, email, phone or role sent
 * in a body or query is never read.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { getStore, toCustomerOrder } from "../_lib/store.js";
import { LIMITS } from "../../shared/ordering.js";
import { siteBaseUrl } from "../_lib/email.js";
import {
  createCustomerSession,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  customerFrom,
  requireCustomer,
  isCustomerAuthConfigured,
  customerAuthStatus,
} from "../_lib/customerAuth.js";
import {
  passwordGrant,
  signUp,
  requestPasswordReset,
  updatePassword,
} from "../_lib/supabaseAuth.js";

const ACTIONS = {
  session: { methods: ["GET"] },
  signup: { methods: ["POST"] },
  login: { methods: ["POST"] },
  logout: { methods: ["DELETE", "POST"] },
  forgot: { methods: ["POST"] },
  reset: { methods: ["POST"] },
  orders: { methods: ["GET"] },
};

/** Same budget as the admin login: enough for a human, pointless to brute-force. */
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  const action = String(req.query?.action ?? "").toLowerCase();
  const definition = ACTIONS[action];

  if (!definition) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    return sendError(res, new ApiError(404, "Not found.", "not_found"));
  }
  if (!methodGuard(req, res, definition.methods)) return;

  try {
    sweepRateLimits();
    return await HANDLERS[action](req, res);
  } catch (error) {
    return sendError(res, error);
  }
}

/* ------------------------------- configuration ---------------------------- */

function requireConfigured() {
  if (!isCustomerAuthConfigured()) {
    throw new ApiError(
      503,
      "Customer sign-in is not configured on this server.",
      "auth_not_configured",
    );
  }
}

/** Best-effort origin for the Supabase email redirect, derived server-side. */
function requestOrigin(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim() || "https";
  const host = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "")
    .split(",")[0]
    .trim();
  if (host) return `${proto}://${host}`;
  return siteBaseUrl().replace(/\/+$/, "");
}

/** Reject a password that Supabase would reject, before spending a round trip. */
function readPassword(value) {
  const password = String(value ?? "");
  if (password.length < 8) {
    throw new ApiError(
      422,
      "Choose a password with at least 8 characters.",
      "weak_password",
      null,
      { password: "Use at least 8 characters." },
    );
  }
  // bcrypt truncates beyond 72 bytes; GoTrue refuses longer input outright in
  // some versions, so the limit is stated rather than silently truncated.
  if (password.length > 72) {
    throw new ApiError(422, "That password is too long.", "weak_password", null, {
      password: "Use at most 72 characters.",
    });
  }
  return password;
}

function readEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    throw new ApiError(422, "Enter a valid email address.", "invalid_email", null, {
      email: "Enter a valid email address.",
    });
  }
  return email;
}

function readName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > LIMITS.name) {
    throw new ApiError(422, "Enter your full name.", "invalid_name", null, {
      name: `Use between 2 and ${LIMITS.name} characters.`,
    });
  }
  return name;
}

/* ------------------------------- the actions ------------------------------ */

const HANDLERS = {
  /** GET /session — no database, just verify the cookie signature. */
  async session(req, res) {
    const status = customerAuthStatus();
    if (!status.sessionSecret || !status.supabase) {
      return sendJson(res, 200, {
        configured: false,
        signedIn: false,
        customer: null,
        reason: "auth_not_configured",
      });
    }
    const customer = customerFrom(req);
    if (!customer) {
      return sendJson(res, 200, { configured: true, signedIn: false, customer: null });
    }
    return sendJson(res, 200, {
      configured: true,
      signedIn: true,
      customer: { id: customer.id, email: customer.email },
      expiresAt: new Date(customer.expiresAt * 1000).toISOString(),
    });
  },

  /** POST /signup */
  async signup(req, res) {
    requireConfigured();
    gateIp(req, "signup");

    const body = await readJson(req);
    const name = readName(body?.name);
    const email = readEmail(body?.email);
    gateAccount("signup", email);
    const password = readPassword(body?.password);
    if (String(body?.confirmPassword ?? "") !== password) {
      throw new ApiError(422, "The passwords do not match.", "password_mismatch", null, {
        confirmPassword: "The passwords do not match.",
      });
    }

    const result = await signUp({
      email,
      password,
      data: { full_name: name },
      emailRedirectTo: `${requestOrigin(req)}/login`,
    });

    // Auto-confirm enabled: GoTrue returned a session, so the account is usable
    // now and we can sign the customer straight in. A user object WITHOUT a
    // session means confirmation is still pending, and no cookie is minted.
    if (result.session) {
      const session = createCustomerSession({ id: result.id, email: result.email });
      setCustomerSessionCookie(res, req, session.token, session.maxAge);
      return sendJson(res, 201, {
        signedIn: true,
        confirmationRequired: false,
        customer: { id: session.payload.sub, email: session.payload.email },
      });
    }

    // Confirmation enabled: no id yet, so no session. Not an error — the
    // customer is told to check their inbox.
    return sendJson(res, 201, {
      signedIn: false,
      confirmationRequired: true,
      customer: null,
    });
  },

  /** POST /login */
  async login(req, res) {
    requireConfigured();
    gateIp(req, "login");

    const body = await readJson(req);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) {
      throw new ApiError(400, "Enter your email address and password.", "credentials_required");
    }
    gateAccount("login", email);

    const user = await passwordGrant({ email, password });
    const session = createCustomerSession(user);
    setCustomerSessionCookie(res, req, session.token, session.maxAge);

    return sendJson(res, 200, {
      signedIn: true,
      customer: { id: session.payload.sub, email: session.payload.email },
    });
  },

  /** DELETE/POST /logout */
  async logout(req, res) {
    clearCustomerSessionCookie(res, req);
    return sendJson(res, 200, { signedOut: true });
  },

  /** POST /forgot */
  async forgot(req, res) {
    requireConfigured();
    gateIp(req, "forgot");

    const body = await readJson(req);
    const email = readEmail(body?.email);
    gateAccount("forgot", email);
    await requestPasswordReset({
      email,
      redirectTo: `${requestOrigin(req)}/reset-password`,
    });
    // The same answer whether or not the address exists, so this cannot be used
    // to discover which emails have accounts.
    return sendJson(res, 200, { sent: true });
  },

  /** POST /reset — the token comes from the recovery email's URL fragment. */
  async reset(req, res) {
    requireConfigured();
    gateIp(req, "reset");

    const body = await readJson(req);
    const password = readPassword(body?.password);
    if (String(body?.confirmPassword ?? "") !== password) {
      throw new ApiError(422, "The passwords do not match.", "password_mismatch", null, {
        confirmPassword: "The passwords do not match.",
      });
    }
    await updatePassword({ accessToken: body?.accessToken, password });
    // No session is minted here: the customer signs in with the new password,
    // which also proves to them that it works.
    return sendJson(res, 200, { reset: true });
  },

  /** GET /orders — the signed-in customer's own orders, newest first. */
  async orders(req, res) {
    requireConfigured();
    // Throws 401 when there is no valid session. There is no fallback path and
    // no query parameter that can widen the result.
    const customer = requireCustomer(req);
    const store = await getStore();
    const rows = await store.listOrdersByCustomer(customer.id);
    return sendJson(res, 200, {
      orders: rows.map(toCustomerOrder),
      customer: { id: customer.id, email: customer.email },
    });
  },
};

/* ------------------------------- rate limiter ----------------------------- */

/**
 * Flood control, per IP. A shared campus or office address should not let one
 * attacker exhaust the server, but it should not lock out legitimate neighbours
 * either, hence the loose budget; the per-account limit below is the tight one.
 */
function gateIp(req, action) {
  const ip = rateLimit({
    key: `customer-${action}-ip:${clientKey(req)}`,
    limit: 30,
    windowMs: ATTEMPT_WINDOW_MS,
  });
  if (!ip.allowed) {
    throw new ApiError(
      429,
      "Too many attempts. Please wait a few minutes and try again.",
      "rate_limited",
    );
  }
}

/**
 * Brute-force control, per account. Called only once the email has been parsed,
 * so one attacker cannot lock a real customer out by spraying from many
 * addresses, nor guess a password quickly from a single one.
 */
function gateAccount(action, email) {
  const perAccount = rateLimit({
    key: `customer-${action}-acct:${email}`,
    limit: ATTEMPT_LIMIT,
    windowMs: ATTEMPT_WINDOW_MS,
  });
  if (!perAccount.allowed) {
    throw new ApiError(
      429,
      "Too many attempts for this account. Please wait a few minutes and try again.",
      "rate_limited",
    );
  }
}
