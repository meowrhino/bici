import type { Hono } from "hono";
import { requireAuth } from "../auth";
import { requireCsrf, rateLimit, parseId } from "../middleware";
import {
  deletePost,
  getPost,
  getReplies,
  listHashtags,
  listPosts,
  restorePost,
} from "../db";
import { validatePostBody, persistPost } from "../posts";
import type { PostBody } from "../posts";
import type { AppEnv } from "../bindings";

export function registerPostRoutes(app: Hono<AppEnv>) {
  // ---------- reads (public) ----------

  app.get("/api/posts", async (c) => {
    const cursor = c.req.query("cursor") || undefined;
    const tag = c.req.query("tag") || undefined;
    const q = c.req.query("q") || undefined;
    const limitRaw = parseInt(c.req.query("limit") || "100");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    const result = await listPosts(c.env.DB, { cursor, tag, q, limit });
    return c.json(result);
  });

  app.get("/api/posts/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "id invalido" }, 400);
    const post = await getPost(c.env.DB, id);
    if (!post) return c.json({ error: "no encontrado" }, 404);
    const replies = await getReplies(c.env.DB, id);
    return c.json({ post, replies });
  });

  app.get("/api/hashtags", async (c) => {
    const tags = await listHashtags(c.env.DB);
    return c.json(tags);
  });

  // ---------- writes (gated) ----------

  app.post("/api/posts", requireAuth(), requireCsrf(), rateLimit((e) => e.WRITE_LIMITER), async (c) => {
    let body: PostBody;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "json invalido" }, 400);
    }

    const v = await validatePostBody(c.env.DB, body);
    if (!v.ok) return c.json({ error: v.error }, v.status);
    const postId = await persistPost(c.env.DB, v);

    const full = await getPost(c.env.DB, postId);
    return c.json(full, 201);
  });

  app.delete("/api/posts/:id", requireAuth(), requireCsrf(), async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "id invalido" }, 400);
    // Soft delete: el post y sus descendientes se marcan con deleted_at pero los
    // assets de R2 se conservan. Recuperable vía POST /api/posts/:id/restore.
    const result = await deletePost(c.env.DB, id);
    if (!result) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true, soft_deleted_ids: result.softDeletedIds });
  });

  app.post("/api/posts/:id/restore", requireAuth(), requireCsrf(), async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "id invalido" }, 400);
    const result = await restorePost(c.env.DB, id);
    if (!result) return c.json({ error: "no encontrado o no estaba borrado" }, 404);
    return c.json({ ok: true, restored_ids: result.restoredIds });
  });
}
