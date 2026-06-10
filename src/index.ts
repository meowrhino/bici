import { Hono } from "hono";
import type { AppEnv } from "./bindings";
import { registerAuthRoutes } from "./routes/auth";
import { registerPostRoutes } from "./routes/posts";
import { registerPlaceRoutes } from "./routes/places";
import { registerUploadRoutes } from "./routes/upload";
import { registerStaticRoutes } from "./routes/static";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error("worker error:", err?.message, err?.stack);
  return c.json({ error: "internal" }, 500);
});

// El ORDEN importa: las rutas concretas (/api/*, /r2/*) se registran antes que
// el catch-all de ASSETS. registerStaticRoutes va EL ÚLTIMO porque incluye el
// app.get("*") que sirve el resto de archivos estáticos.
registerAuthRoutes(app);
registerPostRoutes(app);
registerPlaceRoutes(app);
registerUploadRoutes(app);
registerStaticRoutes(app);

// Re-exportados para los tests (test/post-handler.test.ts importa la lógica de
// validación/persistencia desde aquí).
export { validatePostBody, persistPost } from "./posts";
export default app;
