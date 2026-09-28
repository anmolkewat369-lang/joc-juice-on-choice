/**
 * Admin API client.
 *
 * Every call is `credentials: "same-origin"`, because the session is an httpOnly
 * cookie that JavaScript cannot read — there is no token to attach and none is
 * needed. A 401 means the session expired, and the app responds by returning to
 * the sign-in screen rather than by retrying.
 *
 * The admin session is never cached in localStorage or sessionStorage, and no
 * admin credential or order token is ever written to storage.
 */

export class AdminRequestError extends Error {
  constructor(message, { code = "request_failed", status = 0 } = {}) {
    super(message);
    this.name = "AdminRequestError";
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        // Never let a proxy or the browser cache an order list.
        "Cache-Control": "no-store",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AdminRequestError("Could not reach the server. Check your connection.", {
      code: "network_error",
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.error;
    throw new AdminRequestError(detail?.message ?? "Something went wrong.", {
      code: detail?.code ?? "server_error",
      status: response.status,
    });
  }

  return payload;
}

/** Who am I? Resolves `{ signedIn, admin, configured }` and never throws. */
export const getSession = ({ signal } = {}) =>
  request("/api/admin/session", { signal }).catch((error) => {
    if (error instanceof AdminRequestError) {
      return { signedIn: false, admin: null, configured: true };
    }
    throw error;
  });

export const signIn = (email, password) =>
  request("/api/admin/login", { method: "POST", body: { email, password } });

export const signOut = () => request("/api/admin/login", { method: "DELETE" });

export const listOrders = ({ filter, page, pageSize, signal } = {}) => {
  const query = new URLSearchParams();
  if (filter && filter !== "all") query.set("filter", filter);
  if (page) query.set("page", String(page));
  if (pageSize) query.set("pageSize", String(pageSize));
  const suffix = query.toString();
  return request(`/api/admin/orders${suffix ? `?${suffix}` : ""}`, { signal });
};

export const getOrder = (orderId, { signal } = {}) =>
  request(`/api/admin/orders/${encodeURIComponent(orderId)}`, { signal });

/**
 * Perform one guarded action.
 *
 * The body names an *action*, never a set of fields to write. The server decides
 * whether it is allowed, so a future mistake in this client cannot become a way
 * to mark an arbitrary payment as paid.
 */
export const actOnOrder = (orderId, action, extra = {}) =>
  request(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: { action, ...extra },
  });
