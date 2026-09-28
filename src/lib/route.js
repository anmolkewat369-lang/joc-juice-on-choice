/**
 * Hash router for the ordering flow.
 *
 * The website is a single page built on anchor links (`#menu`, `#about`, …).
 * Rather than introduce a routing library and rewrite every existing link, the
 * order screens get their own namespace: `#/cart`, `#/checkout`, `#/order/JOC-…`.
 * Anything that is not in that namespace is the home page, so every existing
 * anchor, the scroll-spy and the browser back button keep working untouched.
 */

import { useCallback, useEffect, useState } from "react";

export const ROUTES = { CART: "cart", CHECKOUT: "checkout", ORDER: "order" };

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

const parse = (hash) => {
  if (!hash.startsWith("#/")) return { name: "home" };
  const [, segment = "", param = ""] = hash.split("/");
  if (segment === ROUTES.CART) return { name: ROUTES.CART };
  if (segment === ROUTES.CHECKOUT) return { name: ROUTES.CHECKOUT };
  if (segment === ROUTES.ORDER) {
    const orderId = decodeURIComponent(param);
    return ORDER_ID_RE.test(orderId) ? { name: ROUTES.ORDER, orderId } : { name: "home" };
  }
  return { name: "home" };
};

export function currentRoute() {
  if (typeof window === "undefined") return { name: "home" };
  return parse(window.location.hash);
}

export const cartHref = "#/cart";
export const checkoutHref = "#/checkout";
export const orderHref = (orderId) => `#/order/${encodeURIComponent(orderId)}`;
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
