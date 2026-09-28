/**
 * Cart state.
 *
 * Deliberately holds `{ id, qty }` only. Names, prices and line totals are
 * always derived from the menu at render time, so a stale or hand-edited
 * localStorage entry can never change what anything costs. The server recalculates
 * every total regardless.
 *
 * localStorage is the customer's shopping bag on their device — it is not, and
 * must not become, the order database. Orders are created server-side.
 */

import { createContext, useContext } from "react";
import { MAX_QTY_PER_ITEM } from "../../shared/ordering.js";
import { MENU_ITEMS } from "../data/menu.js";

const STORAGE_KEY = "joc.cart.v1";

const CATALOGUE = new Map(MENU_ITEMS.map((item) => [item.id, item]));

export const CartContext = createContext(null);

export const useCart = () => {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>.");
  return value;
};

/* ------------------------------ persistence ------------------------------ */

const clampQty = (qty) => Math.min(Math.max(1, Math.trunc(qty) || 1), MAX_QTY_PER_ITEM);

/** Drop anything that is no longer on the menu, and repair the shape. */
function sanitise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && CATALOGUE.has(entry.id))
    .map((entry) => ({ id: entry.id, qty: clampQty(entry.qty) }));
}

export function readStoredCart() {
  if (typeof window === "undefined") return [];
  try {
    return sanitise(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeStoredCart(items) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private browsing or a full quota — the cart still works for this session.
  }
}

/* -------------------------------- helpers -------------------------------- */

/** Cart entries joined to the live menu, ready to render. */
export function hydrateCart(items) {
  return items
    .map((entry) => {
      const product = CATALOGUE.get(entry.id);
      if (!product) return null;
      return {
        ...product,
        qty: entry.qty,
        lineTotal: product.price * entry.qty,
      };
    })
    .filter(Boolean);
}

export function cartTotals(items) {
  const lines = hydrateCart(items);
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  // Delivery rules live in shared/ordering.js so the cart, the checkout and the
  // server all quote the same number.
  return { lines, subtotal };
}
