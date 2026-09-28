import { Suspense, lazy } from "react";
import Booting from "./Booting.jsx";

/**
 * Two dashboards, one stylesheet, two bundles.
 *
 * The admin dashboard is served at real paths — /admin/login, /admin/orders —
 * rather than behind the site's hash router. The public site keeps its existing
 * hash routing untouched, so no current link, anchor or scroll-spy behaviour
 * changes.
 *
 * Both apps are loaded with `lazy()` so the split is real rather than cosmetic:
 * an admin never downloads the storefront, and a customer never downloads the
 * dashboard or its order data plumbing. The admin module is not even requested
 * until someone visits an /admin path.
 *
 * The choice is made once, at first render, from the path. A customer following an
 * old bookmark, or the store's own #/… links, is unaffected; a refresh on
 * /admin/orders also works, because Vercel rewrites that path to index.html.
 */

const Storefront = lazy(() => import("./App.jsx"));
const AdminDashboard = lazy(() => import("./admin/AdminApp.jsx"));

export default function Root() {
  const path = window.location.pathname;
  const isAdminPath = path === "/admin" || path.startsWith("/admin/");
  const App = isAdminPath ? AdminDashboard : Storefront;

  return (
    <Suspense fallback={<Booting label={isAdminPath ? "Opening the dashboard…" : "Loading…"} />}>
      <App />
    </Suspense>
  );
}
