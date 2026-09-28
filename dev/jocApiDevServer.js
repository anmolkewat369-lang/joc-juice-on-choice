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

const API_PREFIX = "/api/";

export function jocApiDevServer() {
  return {
    name: "joc-api-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(API_PREFIX)) return next();

        try {
          const { default: handler } = await import("../api" + routeFor(req.url));
          await handler(decorate(req), res);
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

/** `/api/orders/JOC-1` -> `/orders/JOC-1` (strip the query string). */
function routeFor(url) {
  return url.split("?")[0].replace(/^\/api/, "") || "/";
}

/** Vercel gives handlers `req.query`; connect's raw request does not have it. */
function decorate(req) {
  const [pathname, search = ""] = req.url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  // Dynamic route segments arrive as a single `orderId` param on Vercel.
  const segments = pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  if (segments.length === 2 && !query.orderId) query.orderId = segments[1];
  return Object.assign(req, { query });
}
