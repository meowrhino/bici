import type { Hono } from "hono";
import { requireAuth } from "../auth";
import { requireCsrf, rateLimit } from "../middleware";
import { buildMediaKey, classifyContentType, maxBytesFor } from "../media";
import { exportAll } from "../db";
import type { AppEnv } from "../bindings";

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post("/api/upload", requireAuth(), requireCsrf(), rateLimit((e) => e.WRITE_LIMITER), async (c) => {
    const ct = c.req.header("x-content-type") || c.req.header("content-type") || "";
    const classified = classifyContentType(ct);
    if (!classified) return c.json({ error: "tipo no permitido" }, 400);

    // Rechazo temprano si el Content-Length declarado ya supera el cap: evita
    // bufferizar el body entero. La doble validación tras .arrayBuffer() lo pilla
    // igual si el cliente miente.
    const cap = maxBytesFor(classified.kind);
    const declared = parseInt(c.req.header("content-length") || "0");
    if (Number.isFinite(declared) && declared > cap) {
      return c.json({ error: "archivo demasiado grande" }, 413);
    }

    const body = await c.req.arrayBuffer();
    if (body.byteLength > cap) {
      return c.json({ error: "archivo demasiado grande" }, 413);
    }

    const key = buildMediaKey("images", classified.ext);
    await c.env.STORAGE.put(key, body, {
      httpMetadata: { contentType: ct },
    });

    return c.json({ key, url: `/r2/${key}`, kind: classified.kind });
  });

  app.get("/api/export", requireAuth(), async (c) => {
    const dump = await exportAll(c.env.DB);
    return new Response(JSON.stringify(dump, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="bici-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  });
}
