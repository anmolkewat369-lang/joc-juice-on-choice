/**
 * Dev-only bridge from the Vite dev server to the /api serverless functions.
 *
 * On Vercel the functions run as real serverless endpoints, so there is nothing
 * to bridge in production. Locally, `npm run dev` serves the site but has no
 * runtime for /api — without this, every order would fail with a confusing
 * "unexpected token" HTML parse error. This middleware runs the same handler
 * with the same environment, so local behaviour matches deployed behaviour.
 *
 * It is a build-time no-op: `apply: "serve"` keeps it out of the bundle.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

const API_PREFIX = "/api/";

/**
 * The real handler file for an incoming path.
 *
 * The map is explicit rather than derived from the URL so the dev bridge can
 * only ever reach an endpoint that actually exists — a typo here fails loudly
 * instead of silently 404ing in development while working in production.
 */
const ROUTES = [
  { match: /^\/orders$/, file: "orders/index.js" },
  { match: /^\/orders\/utr$/, file: "orders/utr.js" },
  { match: /^\/orders\/[^/]+$/, file: "orders/[orderId].js" },
  { match: /^\/delivery\/check$/, file: "delivery/check.js" },
  { match: /^\/delivery\/config$/, file: "delivery/config.js" },
  { match: /^\/payments\/methods$/, file: "payments/methods.js" },
  { match: /^\/payments\/create$/, file: "payments/create.js" },
  { match: /^\/payments\/verify$/, file: "payments/verify.js" },
  { match: /^\/payments\/cancel$/, file: "payments/cancel.js" },
  { match: /^\/admin\/login$/, file: "admin/login.js" },
  { match: /^\/admin\/session$/, file: "admin/session.js" },
  { match: /^\/admin\/orders$/, file: "admin/orders/index.js" },
  { match: /^\/admin\/orders\/[^/]+$/, file: "admin/orders/[orderId].js" },
];

function routeFor(url) {
  const pathname = url.split("?")[0].replace(/^\/api/, "") || "/";
  const found = ROUTES.find((route) => route.match.test(pathname));
  if (!found) throw new Error(`No API handler for ${pathname}`);
  return found;
}

/**
 * Vercel gives handlers `req.query`; connect's raw request does not have it.
 *
 * For a dynamic route the last path segment is the `[param]` value, which is how
 * Vercel surfaces it. Deriving it from the handler's own filename rather than
 * from a hardcoded depth means a new dynamic route is picked up automatically
 * instead of silently receiving `undefined`.
 */
function decorate(req, route) {
  const [pathname, search = ""] = req.url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));

  const dynamic = /\[(\w+)\]\.js$/.exec(route.file);
  if (dynamic) {
    const [, param] = dynamic;
    const segments = pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
    if (segments.length > 0 && query[param] === undefined) query[param] = segments.at(-1);
  }
  return Object.assign(req, { query });
}

/**
 * Vercel hands handlers an Express-flavoured response with `res.status()` and
 * `res.json()`. Node's http response has neither, so the bridge adds them.
 * The handlers themselves are unmodified and identical in both environments.
 */
function decorateRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.end(JSON.stringify(payload));
  };
  return res;
}

export function jocApiDevServer() {
  return {
    name: "joc-api-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(API_PREFIX)) return next();

        try {
          const route = routeFor(req.url);
          // Resolve from the project root, not from this file: Vite bundles
          // vite.config.js into node_modules/.vite-temp, so a relative import
          // here would resolve against the wrong directory.
          const base = pathToFileURL(path.join(server.config.root, "api", route.file)).href;
          // Dev convenience: re-import on every request so handler edits apply
          // without bouncing the server. Node treats each query as a new module.
          const specifier = `${base}?v=${Date.now()}`;
          const { default: handler } = await import(/* @vite-ignore */ specifier);
          await handler(decorate(req, route), decorateRes(res));
        } catch (error) {
          server.config.logger.error(`[joc-api] ${error?.stack ?? error}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: { code: "dev_server_error", message: "The local API could not run." },
            }),
          );
        }
      });
    },
  };
}