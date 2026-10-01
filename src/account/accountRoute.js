/**
 * The account pages live at real paths — /login, /signup, /my-orders and
 * /reset-password — matching the admin dashboard's real paths rather than the
 * storefront's hash routes. There are two reasons:
 *
 *   * an emailed password-reset link must be a real URL the mail client can open,
 *     and Supabase appends its recovery fragment to it; and
 *   * an account page is somewhere a customer can bookmark or share.
 *
 * Everything else in the storefront keeps its hash routing untouched.
 */

export const ACCOUNT_VIEW = {
  LOGIN: "login",
  SIGNUP: "signup",
  MY_ORDERS: "my-orders",
  RESET_PASSWORD: "reset-password",
};

const VIEWS_BY_PATH = {
  "/login": ACCOUNT_VIEW.LOGIN,
  "/signup": ACCOUNT_VIEW.SIGNUP,
  "/my-orders": ACCOUNT_VIEW.MY_ORDERS,
  "/reset-password": ACCOUNT_VIEW.RESET_PASSWORD,
};

const normalisePath = (pathname) => {
  const trimmed = String(pathname ?? "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

export const accountViewFor = (pathname) => VIEWS_BY_PATH[normalisePath(pathname)] ?? null;

export const isAccountPath = (pathname) => accountViewFor(pathname) !== null;

export const loginHref = "/login";
export const signupHref = "/signup";
export const myOrdersHref = "/my-orders";

/**
 * Read `?next=` from the current account URL, allowing only a same-origin,
 * path-relative destination. A value like `//evil.example` or `https://…` is
 * discarded outright rather than trusted and sanitised.
 */
export function safeNextFromLocation(fallback = "/") {
  if (typeof window === "undefined") return fallback;
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
