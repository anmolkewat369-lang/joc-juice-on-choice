/**
 * Customer session context.
 *
 * The server owns the session (an httpOnly cookie); this context only keeps the
 * *answer* to "who is signed in?" so the navbar, the checkout gate and the My
 * Orders page can render without each one re-asking. It never stores a token —
 * there is no token for the browser to store, because the cookie is httpOnly.
 *
 * One request per page load: the cookie is the same one the server checks on
 * every order, so a refresh is all it takes to stay in sync.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getCustomerSession,
  customerLogin,
  customerSignup,
  customerLogout,
} from "../lib/api.js";

const CustomerContext = createContext(null);

// The hook lives beside its provider on purpose: they change together, and this
// file is the only place that knows the context exists. Fast refresh still works
// for the provider itself, so the rule's concern does not apply here.
// oxlint-disable-next-line react/only-export-components
export function useCustomer() {
  const value = useContext(CustomerContext);
  if (!value) throw new Error("useCustomer must be used inside <AuthProvider>.");
  return value;
}

export default function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    customer: null,
    configured: true,
  });

  const refresh = useCallback(async ({ signal } = {}) => {
    try {
      const data = await getCustomerSession({ signal });
      setState({
        status: "ready",
        customer: data.signedIn ? data.customer : null,
        configured: data.configured !== false,
      });
      return data;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      // A server with no auth configured is reported as such rather than as a
      // sign-out, so the account pages can explain themselves.
      setState({ status: "ready", customer: null, configured: false });
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // The state update is the session response arriving over the network, not a
    // render-derived value, so the rule's synchronous-update concern does not
    // apply. Suppressed here rather than project-wide.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh({ signal: controller.signal });
    return () => controller.abort();
  }, [refresh]);

  const login = useCallback(async (credentials) => {
    const data = await customerLogin(credentials);
    setState({ status: "ready", customer: data.customer, configured: true });
    return data;
  }, []);

  const signup = useCallback(async (input) => {
    const data = await customerSignup(input);
    if (data.signedIn && data.customer) {
      setState({ status: "ready", customer: data.customer, configured: true });
    }
    return data;
  }, []);

  const logout = useCallback(async () => {
    await customerLogout().catch(() => {});
    setState((current) => ({ ...current, status: "ready", customer: null }));
  }, []);

  return (
    <CustomerContext.Provider value={{ ...state, refresh, login, signup, logout }}>
      {children}
    </CustomerContext.Provider>
  );
}
