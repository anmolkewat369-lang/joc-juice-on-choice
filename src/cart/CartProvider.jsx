import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_QTY_PER_ITEM, totalsFor } from "../../shared/ordering.js";
import {
  CartContext,
  cartTotals,
  readStoredCart,
  writeStoredCart,
} from "./cartStore";

const clampQty = (qty) => Math.min(Math.max(1, Math.trunc(qty) || 1), MAX_QTY_PER_ITEM);

/**
 * Cart provider. Sits above the router so the navbar badge, the menu cards and
 * every cart/checkout screen read from one place.
 */
export default function CartProvider({ children }) {
  const [items, setItems] = useState(readStoredCart);

  useEffect(() => {
    writeStoredCart(items);
  }, [items]);

  const addItem = useCallback((id, qty = 1) => {
    if (!id) return;
    setItems((current) => {
      const existing = current.find((entry) => entry.id === id);
      if (!existing) return [...current, { id, qty: clampQty(qty) }];
      return current.map((entry) =>
        entry.id === id ? { ...entry, qty: clampQty(entry.qty + qty) } : entry,
      );
    });
  }, []);

  const setQty = useCallback((id, qty) => {
    const next = clampQty(qty);
    setItems((current) =>
      next <= 1 ? current.filter((entry) => entry.id !== id) : current.map((entry) => (entry.id === id ? { ...entry, qty: next } : entry)),
    );
  }, []);

  const increment = useCallback(
    (id) => {
      setItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, qty: Math.min(entry.qty + 1, MAX_QTY_PER_ITEM) } : entry,
        ),
      );
    },
    [],
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
      addItem,
      setQty,
      increment,
      decrement,
      removeItem,
      clearCart,
    };
  }, [items, addItem, setQty, increment, decrement, removeItem, clearCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
