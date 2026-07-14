import {
  buildReplyTree,
  collectDescendants,
  compareFeedDesc,
  isLive,
  toPosts,
} from "./shared";
import type { Post, PostRow } from "./shared";
import type { Store, StoredPost } from "./store";

export async function listPosts(
  store: Store,
  opts: { cursor?: string; tag?: string; q?: string; limit: number },
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // Cap 100 por página: el frontend carga "todo" de forma progresiva con
  // auto-fetch (IntersectionObserver) al llegar al fondo.
  const limit = Math.min(100, Math.max(1, opts.limit));
  const data = await store.data();

  let live = data.posts.filter(isLive);
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    live = live.filter((p) => p.hashtags.includes(tag));
  }
  if (opts.q) {
    // Cap defensivo: TRUNCAR a 200, no descartar el filtro. Case-insensitive
    // como el LIKE de SQLite al que sustituye.
    const q = opts.q.slice(0, 200).toLowerCase();
    live = live.filter((p) => (p.text ?? "").toLowerCase().includes(q));
  }

  let sorted = [...live].sort(compareFeedDesc);
  if (opts.cursor) {
    // cursor encodes (created_at|id) to break ties on same-second posts
    const [cAt, cIdStr] = opts.cursor.split("|");
    const cId = parseInt(cIdStr || "0");
    if (cAt && Number.isFinite(cId)) {
      sorted = sorted.filter(
        (p) => p.created_at < cAt || (p.created_at === cAt && p.id < cId),
      );
    }
  }

  const hasMore = sorted.length > limit;
  const page = sorted.slice(0, limit);
  if (page.length === 0) {
    return { posts: [], nextCursor: null };
  }

  // Cada post de la página puede ser root de su propio BLOQUE. Traemos los
  // descendientes de TODOS los posts de la página. Dedup por id porque un
  // descendiente puede estar también en la página.
  const descRows = collectDescendants(data.posts, page.map((p) => p.id));
  const seenIds = new Set<number>();
  const combined: StoredPost[] = [];
  for (const row of [...page, ...descRows]) {
    if (seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    combined.push(row);
  }

  const allWithExtras = toPosts(data.posts, combined);
  buildReplyTree(allWithExtras);

  const byId = new Map(allWithExtras.map((p) => [p.id, p]));
  const orderedPosts = page.map((r) => byId.get(r.id)!).filter(Boolean);

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}|${last.id}` : null;
  return { posts: orderedPosts, nextCursor };
}

export async function getPost(store: Store, id: number): Promise<Post | null> {
  const data = await store.data();
  const row = data.posts.find((p) => p.id === id && isLive(p));
  if (!row) return null;
  const [withExtras] = toPosts(data.posts, [row]);
  return withExtras;
}

export async function getReplies(
  store: Store,
  parentId: number,
): Promise<Post[]> {
  const data = await store.data();
  const descRows = collectDescendants(data.posts, [parentId]);
  const all = toPosts(data.posts, descRows);
  buildReplyTree(all);
  return all.filter((p) => p.parent_id === parentId);
}

export async function createPost(
  store: Store,
  text: string | null,
  parentId: number | null,
  location: string | null = null,
  lat: number | null = null,
  lng: number | null = null,
): Promise<PostRow> {
  const data = await store.data();
  const post: StoredPost = {
    id: ++data.seq.post,
    text,
    parent_id: parentId,
    created_at: new Date().toISOString(),
    deleted_at: null,
    location,
    lat,
    lng,
    media: [],
    hashtags: [],
  };
  data.posts.push(post);
  await store.save();
  return post;
}

export async function deletePost(
  store: Store,
  id: number,
): Promise<{ softDeletedIds: number[] } | null> {
  // Soft delete: marca deleted_at en el post y sus descendientes vivos pero
  // deja todo intacto (media, hashtags, assets de R2). Para restaurar, basta
  // con NULL-ear deleted_at.
  const data = await store.data();
  const root = data.posts.find((p) => p.id === id && isLive(p));
  if (!root) return null;

  const ids = [id, ...collectDescendants(data.posts, [id]).map((p) => p.id)];

  // deleted_at lleva un nonce de 8 hex chars al final del timestamp ISO para
  // que dos borrados distintos en el mismo milisegundo no compartan valor
  // (sin esto, un restore podía resucitar posts de otro borrado colisionado).
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const deletedAt = `${new Date().toISOString()}-${nonce}`;
  const idSet = new Set(ids);
  for (const p of data.posts) {
    if (idSet.has(p.id)) p.deleted_at = deletedAt;
  }
  await store.save();

  return { softDeletedIds: ids };
}

// Restaurar un post (y sus descendientes que cayeron en el mismo borrado)
// poniendo deleted_at = NULL.
export async function restorePost(
  store: Store,
  id: number,
): Promise<{ restoredIds: number[] } | null> {
  const data = await store.data();
  const post = data.posts.find((p) => p.id === id);
  if (!post || !post.deleted_at) return null;
  const batch = post.deleted_at;
  const restoredIds: number[] = [];
  for (const p of data.posts) {
    if (p.deleted_at === batch) {
      p.deleted_at = null;
      restoredIds.push(p.id);
    }
  }
  await store.save();
  return { restoredIds };
}
