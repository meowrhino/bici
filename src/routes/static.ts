import type { Hono } from "hono";
import type { AppEnv } from "../bindings";

// Servido de R2 (público) + rutas HTML + catch-all de ASSETS. Debe registrarse
// EL ÚLTIMO: el app.get("*") final captura todo lo no casado por rutas previas.
export function registerStaticRoutes(app: Hono<AppEnv>) {
  // ---------- R2 serving (public, like images on twitter) ----------
  app.get("/r2/*", async (c) => {
    const key = c.req.path.replace(/^\/r2\//, "");
    const obj = await c.env.STORAGE.get(key);
    if (!obj) return c.notFound();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("x-content-type-options", "nosniff");
    return new Response(obj.body, { headers });
  });

  // ---------- HTML routes ----------
  app.get("/", (c) =>
    c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url))),
  );
  // Página ligera para publicar (sin el peso del timeline), pensada para poco
  // internet. Sirve compose.html para la URL bonita /compose.
  app.get("/compose", (c) =>
    c.env.ASSETS.fetch(new Request(new URL("/compose.html", c.req.url))),
  );
  // Gestión de sitios guardados (renombrar / borrar / ajustar radio).
  app.get("/places", (c) =>
    c.env.ASSETS.fetch(new Request(new URL("/places.html", c.req.url))),
  );
  // /post/:id quedó obsoleto: ya no hay vista detalle. Redirigimos 301 a /#id.
  app.get("/post/:id", (c) => {
    const id = c.req.param("id");
    return c.redirect(`/#${id}`, 301);
  });

  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
}
