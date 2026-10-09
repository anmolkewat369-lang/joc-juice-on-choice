import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_QTY_PER_ITEM, totalsFor } from "../../shared/ordering.js";
import {
  CartContext,
  cartTotals,
  readStoredCart,
  writeStoredCart,
} from "./cartStore";
import { MENU_ITEMS } from "../data/menu.js";

const clampQty = (qty) => Math.min(Math.max(1, Math.trunc(qty) || 1), MAX_QTY_PER_ITEM);
const VALID_AVAILABILITY = new Set(["available", "out_of_stock", "coming_soon"]);

/**
 * Cart provider. Sits above the router so the navbar badge, the menu cards and
 * every cart/checkout screen read from one place.
 */
export default function CartProvider({ children }) {
  const [items, setItems] = useState(readStoredCart);
  const [availability, setAvailability] = useState({});
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState(null);

  const refreshAvailability = useCallback(async (signal) => {
    try {
      const response = await fetch("/api/menu", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Menu availability could not be loaded.");
      const payload = await response.json();
      if (!Array.isArray(payload?.items)) throw new Error("The menu response was invalid.");

      const next = {};
      for (const item of payload.items) {
        if (!item || typeof item.id !== "string" || !VALID_AVAILABILITY.has(item.availability)) {
          throw new Error("The menu response was missing availability information.");
        }
        next[item.id] = item.availability;
      }
      if (MENU_ITEMS.some((item) => !Object.hasOwn(next, item.id))) {
        throw new Error("The menu response did not include every menu item.");
      }
      setAvailability(next);
      setAvailabilityError(null);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setAvailabilityError(
          error instanceof Error ? error.message : "Menu availability could not be loaded.",
        );
      }
    } finally {
      if (!signal?.aborted) setAvailabilityLoading(false);
    }
  }, []);

  useEffect(() => {
    writeStoredCart(items);
  }, [items]);

  useEffect(() => {
    const controller = new AbortController();
    // The request updates external availability state after its response arrives.
    // oxlint-disable-next-line react/set-state-in-effect
    refreshAvailability(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) refreshAvailability();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) refreshAvailability();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshAvailability]);

  const addItem = useCallback((id, qty = 1) => {
    if (!id) return;
    if (availability[id] !== "available") return;
    setItems((current) => {
      const existing = current.find((entry) => entry.id === id);
      if (!existing) return [...current, { id, qty: clampQty(qty) }];
      return current.map((entry) =>
        entry.id === id ? { ...entry, qty: clampQty(entry.qty + qty) } : entry,
      );
    });
  }, [availability]);

  const setQty = useCallback((id, qty) => {
    if (availability[id] !== "available" && qty > 1) return;
    const next = clampQty(qty);
    setItems((current) =>
      next <= 1 ? current.filter((entry) => entry.id !== id) : current.map((entry) => (entry.id === id ? { ...entry, qty: next } : entry)),
    );
  }, [availability]);

  const increment = useCallback(
    (id) => {
      if (availability[id] !== "available") return;
      setItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, qty: Math.min(entry.qty + 1, MAX_QTY_PER_ITEM) } : entry,
        ),
      );
    },
    [availability],
  );

  const decrement = useCallback((id) => {
    setItems((current) =>
      current
        .map((entry) => (entry.id === id ? { ...entry, qty: entry.qty - 1 } : entry))
        .filter((entry) => entry.qty > 0),
    );
  }, []);

  const removeItem = useCallback((id) => {
    setItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo(() => {
    const { lines, subtotal } = cartTotals(items);
    return {
      items,
      lines,
      subtotal,
      ...totalsFor(subtotal),
      count: items.reduce((sum, entry) => sum + entry.qty, 0),
      isEmpty: items.length === 0,
      availability,
      availabilityLoading,
      availabilityError,
      availabilityFor: (id) => availability[id] ?? null,
      addItem,
      setQty,
      increment,
      decrement,
      removeItem,
      clearCart,
    };
  }, [
    items,
    availability,
    availabilityLoading,
    availabilityError,
    addItem,
    setQty,
    increment,
    decrement,
    removeItem,
    clearCart,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
