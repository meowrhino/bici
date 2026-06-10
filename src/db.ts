import { haversineMeters } from "./geo";

export interface MediaRow {
  id: number;
  post_id: number;
  kind: "image";
  r2_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  position: number;
}

export interface PostRow {
  id: number;
  text: string | null;
  parent_id: number | null;
  created_at: string;
  deleted_at?: string | null;
  // Ubicación opcional. `location` es la etiqueta de texto que se muestra;
  // lat/lng son coords (del botón "ubicación") para enlazar a un mapa. El
  // frontend pinta el link sólo si hay lat+lng; si no, la etiqueta a secas.
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface ParentExcerpt {
  id: number;
  text_snippet: string;
  deleted: boolean;
}

export interface Post extends PostRow {
  media: MediaRow[];
  hashtags: string[];
  reply_count: number;
  replies?: Post[];
  // Sólo presente cuando parent_id != null. Permite al frontend pintar el
  // header "↓ en respuesta a: «snippet»" sin un fetch extra del padre.
  parent_excerpt?: ParentExcerpt | null;
}

// D1 limita los parámetros vinculados por query (~100). Cualquier lista de
// IDs que metamos en un `IN (?,?,…)` hay que trocearla por debajo de ese
// tope. Sin esto, pedir ~200+ posts de golpe reventaba con 500 "internal".
const D1_MAX_BIND = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Ejecuta `SELECT … WHERE col IN (?…)` por lotes de IDs y concatena las filas.
// `sqlFor` recibe el string de placeholders ("?,?,?"). Los lotes corren en paralelo.
async function selectByIds<T>(
  db: D1Database,
  ids: number[],
  sqlFor: (placeholders: string) => string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const batches = chunk(ids, D1_MAX_BIND);
  const res = await Promise.all(
    batches.map((b) =>
      db
        .prepare(sqlFor(b.map(() => "?").join(",")))
        .bind(...b)
        .all<T>(),
    ),
  );
  return res.flatMap((r) => r.results);
}

// Resuelve el parent_excerpt (snippet del padre) de cada post que sea reply.
// Muchos padres ya vienen en `posts` (la TL carga el árbol del BLOQUE) → sacamos
// su snippet de memoria y solo consultamos a la BD los ausentes. NO filtramos
// deleted_at: queremos saber si el padre está borrado para pintar "en respuesta
// a un sitio borrado".
async function resolveParentExcerpts(
  db: D1Database,
  posts: PostRow[],
): Promise<Map<number, ParentExcerpt>> {
  const parentExcerptByPost = new Map<number, ParentExcerpt>();
  const postsById = new Map(posts.map((p) => [p.id, p]));
  const parentIds = [
    ...new Set(
      posts
        .map((p) => p.parent_id)
        .filter((pid): pid is number => pid != null),
    ),
  ];
  const missingParentIds = parentIds.filter((pid) => !postsById.has(pid));
  const fetchedParents = missingParentIds.length
    ? await selectByIds<{ id: number; snippet: string; deleted_at: string | null }>(
        db,
        missingParentIds,
        (ph) => `SELECT id, substr(COALESCE(text, ''), 1, 120) AS snippet, deleted_at
             FROM posts WHERE id IN (${ph})`,
      )
    : [];
  const fetchedById = new Map(fetchedParents.map((r) => [r.id, r]));
  for (const p of posts) {
    if (p.parent_id == null) continue;
    const inMem = postsById.get(p.parent_id);
    if (inMem) {
      parentExcerptByPost.set(p.id, {
        id: p.parent_id,
        text_snippet: (inMem.text ?? "").slice(0, 120),
        deleted: false,
      });
    } else {
      const row = fetchedById.get(p.parent_id);
      parentExcerptByPost.set(p.id, {
        id: p.parent_id,
        text_snippet: row?.snippet ?? "",
        deleted: row ? row.deleted_at != null : true,
      });
    }
  }
  return parentExcerptByPost;
}

// Carga en bloque (1 query por relación, troceada por lotes) los extras de
// cada post: media, hashtags, reply_count y el snippet del padre.
async function attachMediaAndTags(
  db: D1Database,
  posts: PostRow[],
): Promise<Post[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  const [mediaRows, tagRows, replyRows] = await Promise.all([
    selectByIds<MediaRow>(
      db,
      ids,
      (ph) => `SELECT * FROM media WHERE post_id IN (${ph}) ORDER BY post_id, position`,
    ),
    selectByIds<{ post_id: number; tag: string }>(
      db,
      ids,
      (ph) => `SELECT post_id, tag FROM hashtags WHERE post_id IN (${ph})`,
    ),
    selectByIds<{ parent_id: number; c: number }>(
      db,
      ids,
      (ph) => `SELECT parent_id, COUNT(*) as c FROM posts WHERE parent_id IN (${ph}) GROUP BY parent_id`,
    ),
  ]);

  const mediaByPost = new Map<number, MediaRow[]>();
  for (const m of mediaRows) {
    const arr = mediaByPost.get(m.post_id) || [];
    arr.push(m);
    mediaByPost.set(m.post_id, arr);
  }
  const tagsByPost = new Map<number, string[]>();
  for (const t of tagRows) {
    const arr = tagsByPost.get(t.post_id) || [];
    arr.push(t.tag);
    tagsByPost.set(t.post_id, arr);
  }
  const repliesByPost = new Map<number, number>();
  for (const r of replyRows) {
    repliesByPost.set(r.parent_id, r.c);
  }
  const parentExcerptByPost = await resolveParentExcerpts(db, posts);

  return posts.map((p) => ({
    ...p,
    media: mediaByPost.get(p.id) || [],
    hashtags: tagsByPost.get(p.id) || [],
    reply_count: repliesByPost.get(p.id) || 0,
    parent_excerpt: parentExcerptByPost.get(p.id) ?? null,
  }));
}

function buildReplyTree(all: Post[]): void {
  const byParent = new Map<number, Post[]>();
  for (const p of all) {
    if (p.parent_id == null) continue;
    const arr = byParent.get(p.parent_id) || [];
    arr.push(p);
    byParent.set(p.parent_id, arr);
  }
  for (const p of all) {
    p.replies = byParent.get(p.id) || [];
  }
}

// Trae TODOS los descendientes (cualquier profundidad) de los parentIds dados
// con una CTE recursiva, troceada por el límite de parámetros de D1. El level
// cap (256) defiende de ciclos accidentales en parent_id o threads
// patológicamente profundos. Sólo posts vivos.
async function getDescendants(
  db: D1Database,
  parentIds: number[],
): Promise<PostRow[]> {
  return selectByIds<PostRow>(
    db,
    parentIds,
    (ph) => `WITH RECURSIVE descendants(id, text, parent_id, created_at, location, lat, lng, level) AS (
         SELECT p.id, p.text, p.parent_id, p.created_at, p.location, p.lat, p.lng, 1
           FROM posts p WHERE p.parent_id IN (${ph}) AND p.deleted_at IS NULL
         UNION ALL
         SELECT c.id, c.text, c.parent_id, c.created_at, c.location, c.lat, c.lng, d.level + 1
           FROM posts c JOIN descendants d ON c.parent_id = d.id
           WHERE d.level < 256 AND c.deleted_at IS NULL
       )
       SELECT id, text, parent_id, created_at, location, lat, lng FROM descendants ORDER BY created_at ASC`,
  );
}

export async function listPosts(
  db: D1Database,
  opts: { cursor?: string; tag?: string; q?: string; limit: number },
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // Cap 100 por página: el frontend carga "todo" de forma progresiva con
  // auto-fetch (IntersectionObserver) al llegar al fondo.
  const limit = Math.min(100, Math.max(1, opts.limit));
  const conds: string[] = ["p.deleted_at IS NULL"];
  const args: unknown[] = [];

  if (opts.tag) {
    conds.push(
      "EXISTS (SELECT 1 FROM hashtags h WHERE h.post_id = p.id AND h.tag = ?)",
    );
    args.push(opts.tag.toLowerCase());
  }
  if (opts.q) {
    // Cap defensivo: TRUNCAR a 200, no descartar el filtro. Escapar wildcards
    // LIKE (% y _ → literales).
    const escaped = opts.q.slice(0, 200).replace(/[\\%_]/g, "\\$&");
    conds.push("p.text LIKE ? ESCAPE '\\'");
    args.push(`%${escaped}%`);
  }
  if (opts.cursor) {
    // cursor encodes (created_at|id) to break ties on same-second posts
    const [cAt, cIdStr] = opts.cursor.split("|");
    const cId = parseInt(cIdStr || "0");
    if (cAt && Number.isFinite(cId)) {
      conds.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
      args.push(cAt, cAt, cId);
    }
  }

  const sql = `SELECT p.* FROM posts p WHERE ${conds.join(" AND ")} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`;
  args.push(limit + 1);

  const res = await db
    .prepare(sql)
    .bind(...args)
    .all<PostRow>();
  const rows = res.results;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  if (page.length === 0) {
    return { posts: [], nextCursor: null };
  }

  // Cada post de la página puede ser root de su propio BLOQUE. Traemos los
  // descendientes de TODOS los posts de la página. Dedup por id porque un
  // descendiente puede estar también en la página.
  const pageIds = page.map((p) => p.id);
  const descRows = await getDescendants(db, pageIds);

  const seenIds = new Set<number>();
  const combined: PostRow[] = [];
  for (const row of [...page, ...descRows]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    combined.push(row);
  }

  const allWithExtras = await attachMediaAndTags(db, combined);
  buildReplyTree(allWithExtras);

  const byId = new Map(allWithExtras.map((p) => [p.id, p]));
  const orderedPosts = page.map((r) => byId.get(r.id)!).filter(Boolean);

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}|${last.id}` : null;
  return { posts: orderedPosts, nextCursor };
}

export async function getPost(
  db: D1Database,
  id: number,
): Promise<Post | null> {
  const row = await db
    .prepare("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<PostRow>();
  if (!row) return null;
  const [withExtras] = await attachMediaAndTags(db, [row]);
  return withExtras;
}

export async function getReplies(
  db: D1Database,
  parentId: number,
): Promise<Post[]> {
  const descRows = await getDescendants(db, [parentId]);
  const all = await attachMediaAndTags(db, descRows);
  buildReplyTree(all);
  return all.filter((p) => p.parent_id === parentId);
}

export async function createPost(
  db: D1Database,
  text: string | null,
  parentId: number | null,
  location: string | null = null,
  lat: number | null = null,
  lng: number | null = null,
): Promise<PostRow> {
  const row = await db
    .prepare(
      "INSERT INTO posts (text, parent_id, location, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) RETURNING *",
    )
    .bind(text, parentId, location, lat, lng)
    .first<PostRow>();
  return row!;
}

export async function attachMedia(
  db: D1Database,
  postId: number,
  items: Array<{
    kind: "image";
    r2_key: string;
    thumb_key: string | null;
    width: number | null;
    height: number | null;
  }>,
) {
  if (items.length === 0) return;
  const stmt = db.prepare(
    "INSERT INTO media (post_id, kind, r2_key, thumb_key, width, height, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  await db.batch(
    items.map((m, i) =>
      stmt.bind(postId, m.kind, m.r2_key, m.thumb_key, m.width, m.height, i),
    ),
  );
}

export async function deletePost(
  db: D1Database,
  id: number,
): Promise<{ softDeletedIds: number[] } | null> {
  // Soft delete: marca deleted_at en el post y sus descendientes pero deja
  // todo intacto (media, hashtags, assets de R2). Para restaurar, basta con
  // NULL-ear deleted_at.
  const exists = await db
    .prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ id: number }>();
  if (!exists) return null;

  const idsRes = await db
    .prepare(
      `WITH RECURSIVE descendants(id, level) AS (
         SELECT id, 1 FROM posts WHERE id = ?
         UNION ALL
         SELECT p.id, d.level + 1
           FROM posts p JOIN descendants d ON p.parent_id = d.id
           WHERE d.level < 256 AND p.deleted_at IS NULL
       )
       SELECT id FROM descendants`,
    )
    .bind(id)
    .all<{ id: number }>();
  const ids = idsRes.results.map((r) => r.id);
  if (ids.length === 0) return { softDeletedIds: [] };
  const placeholders = ids.map(() => "?").join(",");

  // deleted_at lleva un nonce de 8 hex chars al final del timestamp ISO para
  // que dos borrados distintos en el mismo milisegundo no compartan valor
  // (sin esto, un restore podía resucitar posts de otro borrado colisionado).
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const deletedAt = `${new Date().toISOString()}-${nonce}`;
  await db
    .prepare(`UPDATE posts SET deleted_at = ? WHERE id IN (${placeholders})`)
    .bind(deletedAt, ...ids)
    .run();

  return { softDeletedIds: ids };
}

// Restaurar un post (y sus descendientes que cayeron en el mismo borrado)
// poniendo deleted_at = NULL.
export async function restorePost(
  db: D1Database,
  id: number,
): Promise<{ restoredIds: number[] } | null> {
  const exists = await db
    .prepare("SELECT id, deleted_at FROM posts WHERE id = ?")
    .bind(id)
    .first<{ id: number; deleted_at: string | null }>();
  if (!exists || !exists.deleted_at) return null;
  const res = await db
    .prepare(
      `UPDATE posts SET deleted_at = NULL
         WHERE deleted_at = ?
         RETURNING id`,
    )
    .bind(exists.deleted_at)
    .all<{ id: number }>();
  return { restoredIds: res.results.map((r) => r.id) };
}

export async function listHashtags(
  db: D1Database,
): Promise<Array<{ tag: string; count: number }>> {
  const res = await db
    .prepare(
      "SELECT tag, COUNT(*) as count FROM hashtags GROUP BY tag ORDER BY count DESC, tag ASC",
    )
    .all<{ tag: string; count: number }>();
  return res.results;
}

// ---------- places (sitios guardados / geofence) ----------

export interface PlaceRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  owner: string;
  created_at: string;
}

export async function listPlaces(db: D1Database): Promise<PlaceRow[]> {
  const res = await db
    .prepare("SELECT * FROM places ORDER BY id")
    .all<PlaceRow>();
  return res.results;
}

export async function createPlace(
  db: D1Database,
  name: string,
  lat: number,
  lng: number,
  radius = 150,
  owner = "me",
): Promise<PlaceRow> {
  const row = await db
    .prepare(
      "INSERT INTO places (name, lat, lng, radius, owner) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(name, lat, lng, radius, owner)
    .first<PlaceRow>();
  return row!;
}

// Renombra / ajusta el radio de un sitio, SOLO si pertenece a `owner`. El check
// de owner va en el WHERE para que sea atómico.
export async function updatePlace(
  db: D1Database,
  id: number,
  fields: { name: string; radius: number },
  owner = "me",
): Promise<PlaceRow | null> {
  const row = await db
    .prepare(
      "UPDATE places SET name = ?, radius = ? WHERE id = ? AND owner = ? RETURNING *",
    )
    .bind(fields.name, fields.radius, id, owner)
    .first<PlaceRow>();
  return row ?? null;
}

export async function deletePlace(
  db: D1Database,
  id: number,
  owner = "me",
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM places WHERE id = ? AND owner = ?")
    .bind(id, owner)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// Devuelve el primer sitio guardado cuyo radio contiene el punto dado, o null.
// La tabla es pequeña (single-user) → cargarla entera y filtrar en memoria basta.
export async function findNearbyPlace(
  db: D1Database,
  lat: number,
  lng: number,
): Promise<PlaceRow | null> {
  const places = await listPlaces(db);
  for (const p of places) {
    if (haversineMeters(lat, lng, p.lat, p.lng) <= p.radius) return p;
  }
  return null;
}

export async function exportAll(db: D1Database) {
  // Solo posts vivos: el resto de queries filtran deleted_at IS NULL; el export
  // respeta el mismo contrato. media/hashtags cuelgan por post_id; excluimos los
  // hijos de posts borrados con un subselect.
  const [posts, media, hashtags, places] = await Promise.all([
    db.prepare("SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY id").all(),
    db
      .prepare(
        "SELECT * FROM media WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NULL) ORDER BY post_id, position",
      )
      .all(),
    db
      .prepare(
        "SELECT * FROM hashtags WHERE post_id IN (SELECT id FROM posts WHERE deleted_at IS NULL) ORDER BY post_id, tag",
      )
      .all(),
    db.prepare("SELECT * FROM places ORDER BY id").all(),
  ]);
  return {
    exported_at: new Date().toISOString(),
    posts: posts.results,
    media: media.results,
    hashtags: hashtags.results,
    places: places.results,
  };
}
