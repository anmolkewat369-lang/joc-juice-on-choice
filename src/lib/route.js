/**
 * Hash router for the ordering flow.
 *
 * The website is a single page built on anchor links (`#menu`, `#about`, …).
 * Rather than introduce a routing library and rewrite every existing link, the
 * order screens get their own namespace: `#/cart`, `#/checkout`, `#/order/JOC-…`.
 * Anything that is not in that namespace is the home page, so every existing
 * anchor, the scroll-spy and the browser back button keep working untouched.
 *
 * The order route also accepts `?t=<token>` INSIDE the fragment:
 *
 *     #/order/JOC-20260930-0001?t=1f3c…
 *
 * That is the emailed tracking link, and the fragment is the whole reason it is
 * shaped that way. A fragment is never sent in the HTTP request, so the order
 * secret never reaches Vercel's access logs, a CDN, a `Referer` header, or an
 * analytics script — while still being readable right here by the client that
 * needs it. A `?token=` in the *query* string would do none of that: it is logged
 * by everything between the customer's mail client and this page.
 */

import { useCallback, useEffect, useState } from "react";

export const ROUTES = { CART: "cart", CHECKOUT: "checkout", ORDER: "order" };

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

/** The per-order secret is 48 hex characters. Anything else is ignored outright. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Split `#/order/<id>?t=<token>` into its two halves.
 *
 * Written by hand rather than with URLSearchParams because `new URL()` would need
 * an absolute base and would also normalise the fragment in ways this simple
 * namespace does not need. The token is validated to a plausible shape before it
 * is used, so a malformed or hostile fragment cannot become a header value.
 */
const parseOrderRoute = (rest) => {
  const [path, query = ""] = rest.split("?");
  const orderId = decodeURIComponent(path);
  if (!ORDER_ID_RE.test(orderId)) return { name: "home" };

  const token = new URLSearchParams(query).get("t");
  return {
    name: ROUTES.ORDER,
    orderId,
    // Absent rather than null when there is no usable token, so a caller can use
    // truthiness and never accidentally send the string "null" as a header.
    token: token && TOKEN_RE.test(token) ? token : undefined,
  };
};

const parse = (hash) => {
  if (!hash.startsWith("#/")) return { name: "home" };
  const [, segment = "", ...rest] = hash.split("/");
  const tail = rest.join("/");
  if (segment === ROUTES.CART) return { name: ROUTES.CART };
  if (segment === ROUTES.CHECKOUT) return { name: ROUTES.CHECKOUT };
  if (segment === ROUTES.ORDER) return parseOrderRoute(tail);
  return { name: "home" };
};

export function currentRoute() {
  if (typeof window === "undefined") return { name: "home" };
  return parse(window.location.hash);
}

export const cartHref = "#/cart";
export const checkoutHref = "#/checkout";
export const orderHref = (orderId) => `#/order/${encodeURIComponent(orderId)}`;

/** The tracking link shape. The token goes in the fragment, never the query. */
export const orderTrackingHref = (orderId, token) =>
  `${orderHref(orderId)}?t=${encodeURIComponent(token)}`;

export const homeHref = "#home";

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((href, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState(null, "", href);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (window.location.hash === href) return;
    window.location.hash = href;
  }, []);

  return { route, navigate };
}

/** Order screens always start at the top; the home page keeps its anchors. */
export function useScrollReset(name) {
  useEffect(() => {
    if (name === "home") return;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }, [name]);
}
