import type { Hono } from "hono";
import { requireAuth } from "../auth";
import { requireCsrf, parseId } from "../middleware";
import { listPlaces, updatePlace, deletePlace } from "../db";
import { OWNER_ID } from "../bindings";
import { LOCATION_MAX_LEN } from "../posts";
import type { AppEnv } from "../bindings";

// Sitios guardados (geofence). Datos del dueño → requireAuth. El composer los
// pide al cargar para autorrellenar el nombre cuando capturas GPS cerca de uno.
export function registerPlaceRoutes(app: Hono<AppEnv>) {
  app.get("/api/places", requireAuth(), async (c) => {
    return c.json(await listPlaces(c.env.DB));
  });

  app.patch("/api/places/:id", requireAuth(), requireCsrf(), async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "id invalido" }, 400);
    let body: { name?: string; radius?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "json invalido" }, 400);
    }
    const name = String(body.name ?? "").trim().slice(0, LOCATION_MAX_LEN);
    if (!name) return c.json({ error: "nombre vacio" }, 400);
    const raw = Number(body.radius);
    const radius = Number.isFinite(raw) && raw >= 10 && raw <= 100000 ? raw : 150;
    const updated = await updatePlace(c.env.DB, id, { name, radius }, OWNER_ID);
    if (!updated) return c.json({ error: "no encontrado" }, 404);
    return c.json(updated);
  });

  app.delete("/api/places/:id", requireAuth(), requireCsrf(), async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "id invalido" }, 400);
    const ok = await deletePlace(c.env.DB, id, OWNER_ID);
    if (!ok) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true });
  });
}
