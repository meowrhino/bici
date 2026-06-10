import type { Hono } from "hono";
import {
  isAuthed,
  setAuthCookie,
  clearAuthCookie,
  timingSafeEqual,
} from "../auth";
import { maxBytesFor } from "../media";
import type { AppEnv } from "../bindings";

export function registerAuthRoutes(app: Hono<AppEnv>) {
  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const pw = (form.password as string) || "";
    if (!c.env.PASSWORD || !timingSafeEqual(pw, c.env.PASSWORD)) {
      return c.redirect("/login.html?e=1");
    }
    await setAuthCookie(c, c.env.AUTH_SECRET);
    return c.redirect("/");
  });

  app.post("/logout", (c) => {
    clearAuthCookie(c);
    return c.redirect("/");
  });

  app.get("/api/me", async (c) => {
    return c.json({
      authed: await isAuthed(c),
      // Tope de tamaño (bytes) de imagen, para que el cliente avise ANTES de
      // subir en vez de tras el upload. El server lo revalida igualmente.
      media: {
        image: maxBytesFor("image"),
      },
    });
  });
}
