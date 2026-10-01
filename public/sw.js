/*
 * JOC service worker — Web Push only.
 *
 * It deliberately does NOT cache or intercept fetch. Its one job is to receive a
 * push from the server, show a notification, and open the right JOC page when
 * the notification is clicked. Keeping it that small means a stale cache can
 * never serve an old menu or an old order page.
 *
 * The payload is written by api/_lib/push.js:
 *
 *   { title, body, url, tag, data: { kind, orderId, orderStatus? } }
 *
 * The `url` is treated as untrusted even though the server builds it: it is
 * parsed against this origin and anything cross-origin is dropped, so a
 * malformed payload can never turn a click into a redirect somewhere else.
 */

const DEFAULT_TITLE = "JOC";
const FALLBACK_URL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  const empty = { title: DEFAULT_TITLE, body: "", url: FALLBACK_URL, tag: undefined, data: {} };
  if (!event.data) return empty;
  try {
    const parsed = event.data.json();
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      title: String(parsed.title || DEFAULT_TITLE).slice(0, 120),
      body: String(parsed.body || "").slice(0, 400),
      url: String(parsed.url || FALLBACK_URL),
      tag: parsed.tag ? String(parsed.tag) : undefined,
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    };
  } catch {
    // A non-JSON push is still a valid event; show something rather than nothing.
    try {
      return { ...empty, body: String(event.data.text()).slice(0, 400) };
    } catch {
      return empty;
    }
  }
}

/** Only same-origin, in-site destinations survive. */
function resolveTarget(raw) {
  try {
    const url = new URL(String(raw || FALLBACK_URL), self.location.origin);
    if (url.origin !== self.location.origin) return FALLBACK_URL;
    return url.pathname + url.search + url.hash;
  } catch {
    return FALLBACK_URL;
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: false,
      icon: "/favicon.svg",
      data: { url: payload.url, ...payload.data },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = resolveTarget(event.notification?.data?.url);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Reuse an open tab when there is one, so a click does not pile up windows.
      for (const client of clientList) {
        if ("focus" in client) {
          try {
            if ("navigate" in client) await client.navigate(target);
          } catch {
            /* navigating a tab we no longer own is not fatal */
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
