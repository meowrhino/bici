import { Hono } from "hono";
import {
  isAuthed,
  requireAuth,
  setAuthCookie,
  clearAuthCookie,
  timingSafeEqual,
} from "./auth";
import type { Context, Next } from "hono";
import {
  attachMedia,
  createPlace,
  createPost,
  deletePlace,
  deletePost,
  exportAll,
  findNearbyPlace,
  getPost,
  getReplies,
  listHashtags,
  listPlaces,
  listPosts,
  restorePost,
  updatePlace,
} from "./db";
import { syncHashtags } from "./hashtags";
import { buildMediaKey, classifyContentType, maxBytesFor } from "./media";

// ---------- config ----------

// Dueño de los sitios guardados. Hoy hay un solo usuario (auth por contraseña
// compartida) → identidad fija.
const OWNER_ID = "me";

// Parsea un :id de ruta a entero positivo estricto. null si no es válido.
function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Binding de rate limiting nativo (wrangler.toml [[unsafe.bindings]]).
interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  ASSETS: Fetcher;
  PASSWORD: string;
  AUTH_SECRET: string;
  WRITE_LIMITER: RateLimit;
};

const app = new Hono<{ Bindings: Bindings }>();

app.onError((err, c) => {
  console.error("worker error:", err?.message, err?.stack);
  return c.json({ error: "internal" }, 500);
});

// CSRF: writes require a custom header that HTML forms cannot set, so cross-site
// form POSTs cannot reach this endpoint.
function requireCsrf() {
  return async (c: Context, next: Next) => {
    if (c.req.header("x-bici-csrf") !== "1") {
      return c.json({ error: "csrf" }, 403);
    }
    await next();
  };
}

// Rate limit por IP usando el binding nativo de Workers. Fail-open a propósito
// (no bloqueamos por un fallo del limitador) pero logueado.
function rateLimit(pick: (env: Bindings) => RateLimit) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    try {
      const ip = c.req.header("cf-connecting-ip") || "local";
      const { success } = await pick(c.env).limit({ key: ip });
      if (!success) {
        return c.json({ error: "demasiadas peticiones, espera un momento" }, 429);
      }
    } catch (e) {
      console.error("rate limiter no disponible:", e);
    }
    await next();
  };
}

// ---------- auth ----------

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

// ---------- API: reads (public) ----------

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

// Sitios guardados (geofence). Datos del dueño → requireAuth. El composer los
// pide al cargar para autorrellenar el nombre cuando capturas GPS cerca de uno.
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

// ---------- API: writes (gated) ----------

type PostBody = {
  text?: string | null;
  parent_id?: number | null;
  media?: Array<{
    kind: "image";
    r2_key: string;
    thumb_key?: string | null;
    width?: number | null;
    height?: number | null;
  }>;
  // Ubicación opcional: etiqueta de texto + coords (del botón "ubicación").
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type MediaInput = {
  kind: "image";
  r2_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
};

type PostValidation =
  | { ok: false; error: string; status: 400 | 404 }
  | {
      ok: true;
      text: string | null;
      media: MediaInput[];
      parentId: number | null;
      location: string | null;
      lat: number | null;
      lng: number | null;
    };

// Tope de la etiqueta de ubicación (coincide con el maxlength del input).
const LOCATION_MAX_LEN = 120;

// Valida y sanea el body de un post nuevo. Devuelve los valores listos para
// persistir, o el primer error con su status. Async porque comprueba en BD que
// el parent exista. Exportada para testear la validación aislada del HTTP.
export async function validatePostBody(
  db: D1Database,
  body: PostBody,
): Promise<PostValidation> {
  const text = (body.text ?? "").trim() || null;
  const rawMedia = body.media ?? [];

  if (!text && rawMedia.length === 0)
    return { ok: false, error: "post vacio", status: 400 };
  if (text && text.length > 4000)
    return { ok: false, error: "texto demasiado largo", status: 400 };
  // Cap de media: sin tope, un body manipulado podría spamear la tabla media.
  if (rawMedia.length > 12)
    return { ok: false, error: "demasiados adjuntos", status: 400 };
  // Validación runtime de cada media: los tipos TS no aplican en runtime y el
  // schema no tiene CHECK, así que un body manipulado podría meter basura.
  for (const m of rawMedia) {
    if (m.kind !== "image")
      return { ok: false, error: "kind de media invalido", status: 400 };
    if (typeof m.r2_key !== "string" || !m.r2_key)
      return { ok: false, error: "media sin r2_key", status: 400 };
  }

  if (body.parent_id != null) {
    const parent = await db
      .prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL")
      .bind(body.parent_id)
      .first<{ id: number }>();
    if (!parent) return { ok: false, error: "parent no existe", status: 404 };
  }

  const media: MediaInput[] = rawMedia.map((m) => ({
    kind: "image",
    r2_key: m.r2_key,
    thumb_key: m.thumb_key ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
  }));

  // Ubicación. La etiqueta se trunca a LOCATION_MAX_LEN. Las coords solo se
  // guardan si AMBAS son números válidos en rango — un map link necesita las dos.
  const location = String(body.location ?? "").trim().slice(0, LOCATION_MAX_LEN) || null;
  const { lat, lng } = parseCoords(body.lat, body.lng);

  return { ok: true, text, media, parentId: body.parent_id ?? null, location, lat, lng };
}

// Valida un par lat/lng. Devuelve ambos como número solo si los dos son finitos
// y caen en rango geográfico; en cualquier otro caso devuelve ambos null.
function parseCoords(rawLat: unknown, rawLng: unknown): { lat: number | null; lng: number | null } {
  // null/undefined/"" = "no vino coord". OJO: Number(null) === 0, así que sin
  // este guard un post con SOLO etiqueta acabaría con lat/lng 0,0 espurios.
  if (rawLat == null || rawLng == null || rawLat === "" || rawLng === "")
    return { lat: null, lng: null };
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const ok =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return ok ? { lat, lng } : { lat: null, lng: null };
}

// Persiste un post ya validado (fila + media + hashtags). Devuelve el id del
// post creado. Exportada para testear la persistencia.
export async function persistPost(
  db: D1Database,
  v: {
    text: string | null;
    media: MediaInput[];
    parentId: number | null;
    location: string | null;
    lat: number | null;
    lng: number | null;
  },
): Promise<number> {
  const post = await createPost(db, v.text, v.parentId, v.location, v.lat, v.lng);
  await attachMedia(db, post.id, v.media);
  await syncHashtags(db, post.id, v.text);

  // Geofence: si el post trae ubicación CON NOMBRE + coords y no hay ya un sitio
  // guardado dentro de su radio, lo guardamos para autorrellenar la próxima vez.
  // En try/catch: un fallo aquí nunca debe tumbar la publicación.
  if (v.location && v.lat != null && v.lng != null) {
    try {
      const near = await findNearbyPlace(db, v.lat, v.lng);
      if (!near) await createPlace(db, v.location, v.lat, v.lng, 150, OWNER_ID);
    } catch (err) {
      console.error("auto-save place failed:", err);
    }
  }
  return post.id;
}

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

export default app;
