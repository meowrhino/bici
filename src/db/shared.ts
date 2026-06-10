// Tipos compartidos + helpers de query transversales del data layer (D1).
// Estos helpers son privados al paquete db/: el barrel (db/index.ts) re-exporta
// SOLO las interfaces, no estas funciones.

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
export const D1_MAX_BIND = 90;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Ejecuta `SELECT … WHERE col IN (?…)` por lotes de IDs y concatena las filas.
// `sqlFor` recibe el string de placeholders ("?,?,?"). Los lotes corren en paralelo.
export async function selectByIds<T>(
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
export async function resolveParentExcerpts(
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
export async function attachMediaAndTags(
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

export function buildReplyTree(all: Post[]): void {
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
export async function getDescendants(
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
