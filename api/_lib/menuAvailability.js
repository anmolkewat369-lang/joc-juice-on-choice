/**
 * Menu availability API, dispatched by the existing admin-orders function so
 * the public endpoint does not consume another Vercel Hobby function slot.
 */

import { MENU_ITEMS } from "../../src/data/menu.js";
import { ApiError, methodGuard, readJson, sendError, sendJson } from "./http.js";
import { requireAdmin } from "./adminAuth.js";
import { getStore } from "./store.js";

const VALID_STATUSES = new Set(["available", "out_of_stock", "coming_soon"]);
const MENU_BY_ID = new Map(MENU_ITEMS.map((item) => [item.id, item]));

export async function handleMenuAvailability(req, res) {
  if (!methodGuard(req, res, ["GET", "PATCH"])) return;

  try {
    const admin = req.method === "PATCH" ? requireAdmin(req) : null;
    const store = await getStore();

    if (req.method === "GET") {
      const overrides = await store.listMenuAvailability();
      const availability = new Map(overrides.map((row) => [row.itemId, row.status]));
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return sendJson(res, 200, {
        items: MENU_ITEMS.map((item) => ({
          ...item,
          availability: availability.get(item.id) ?? "available",
        })),
      });
    }

    if (!store.durable) {
      throw new ApiError(
        503,
        "Menu availability cannot be changed until durable database storage is configured.",
        "menu_storage_unavailable",
      );
    }

    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "Invalid request body.", "invalid_body");
    }
    if (typeof body.itemId !== "string" || !MENU_BY_ID.has(body.itemId)) {
      throw new ApiError(404, "Menu item not found.", "menu_item_not_found");
    }
    if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status)) {
      throw new ApiError(
        422,
        "Choose Available, Out of Stock, or Coming Soon.",
        "invalid_availability_status",
      );
    }

    const availability = await store.setMenuAvailability(body.itemId, body.status, admin.id);
    const item = MENU_BY_ID.get(body.itemId);
    return sendJson(res, 200, {
      item: { ...item, availability: availability.status },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
