/**
 * Trusted product catalogue + server-side price calculation.
 *
 * The browser sends `productId + quantity` and nothing else. Prices, names and
 * line totals are resolved here from the same menu file the website renders,
 * so a tampered request cannot set its own price.
 */

import { MENU_ITEMS } from "../../src/data/menu.js";
import {
  MAX_QTY_PER_ITEM,
  CURRENCY,
  normaliseItems,
  totalsFor,
} from "../../shared/ordering.js";

const CATALOGUE = new Map(MENU_ITEMS.map((item) => [item.id, item]));

/** Orderable = anything in the menu. Single source, no duplicate dataset. */
export function isOrderable(productId) {
  return CATALOGUE.has(productId);
}

export function productFor(productId) {
  return CATALOGUE.get(productId) ?? null;
}

/**
 * Turn a client item list into priced lines.
 * Unknown or unavailable products abort the whole order rather than silently
 * dropping a line — a partially priced order is worse than a clear error.
 */
export function priceItems(rawItems) {
  const { items, error } = normaliseItems(rawItems);
  if (error) return { lines: [], totals: null, error };

  const lines = [];
  const unavailable = [];

  for (const { id, qty } of items) {
    const product = CATALOGUE.get(id);
    if (!product || !Number.isFinite(product.price) || product.price <= 0) {
      unavailable.push(id);
      continue;
    }
    const lineTotal = product.price * qty;
    lines.push({
      id: product.id,
      name: product.name,
      category: product.category,
      size: product.size ?? null,
      price: product.price,
      qty,
      lineTotal,
    });
  }

  if (unavailable.length > 0) {
    return { lines: [], totals: null, error: unavailableItemError() };
  }

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return { lines, totals: totalsFor(subtotal), error: null };
}

function unavailableItemError() {
  return (
    "One or more items are no longer available. Please review your cart and try again."
  );
}

export { MAX_QTY_PER_ITEM, CURRENCY };
