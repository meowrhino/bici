// Tipos compartidos + helpers transversales del data layer (JSON en R2).
// Estos helpers son privados al paquete db/: el barrel (db/index.ts) re-exporta
// SOLO las interfaces, no estas funciones.

import type { StoredPost } from "./store";

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

export function isLive(p: StoredPost): boolean {
  return p.deleted_at == null;
}

// Orden del feed: created_at DESC con desempate por id DESC (posts en el mismo
// milisegundo). Los created_at son ISO-8601 → comparan bien como strings.
export function compareFeedDesc(a: StoredPost, b: StoredPost): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return b.id - a.id;
}

// Todos los descendientes VIVOS (cualquier profundidad) de los roots dados,
// en orden cronológico ASC (como el CTE recursivo que reemplaza). El Set de
// visitados defiende de ciclos accidentales en parent_id.
export function collectDescendants(
  all: StoredPost[],
  rootIds: number[],
): StoredPost[] {
  const childrenByParent = new Map<number, StoredPost[]>();
  for (const p of all) {
    if (p.parent_id == null || !isLive(p)) continue;
    const arr = childrenByParent.get(p.parent_id) || [];
    arr.push(p);
    childrenByParent.set(p.parent_id, arr);
  }
  const seen = new Set<number>(rootIds);
  const out: StoredPost[] = [];
  let frontier = rootIds;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const child of childrenByParent.get(id) || []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  out.sort((a, b) =>
    a.created_at !== b.created_at
      ? a.created_at < b.created_at ? -1 : 1
      : a.id - b.id,
  );
  return out;
}

// Convierte StoredPosts en Posts de la API: añade reply_count (hijos vivos) y
// parent_excerpt (snippet del padre, esté vivo o borrado). `all` es la lista
// completa (incluida papelera) para poder resolver padres borrados.
export function toPosts(all: StoredPost[], subset: StoredPost[]): Post[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const replyCount = new Map<number, number>();
  for (const p of all) {
    if (p.parent_id == null || !isLive(p)) continue;
    replyCount.set(p.parent_id, (replyCount.get(p.parent_id) ?? 0) + 1);
  }
  return subset.map((p) => {
    let parent_excerpt: ParentExcerpt | null = null;
    if (p.parent_id != null) {
      const parent = byId.get(p.parent_id);
      parent_excerpt = {
        id: p.parent_id,
        text_snippet: (parent?.text ?? "").slice(0, 120),
        deleted: parent ? parent.deleted_at != null : true,
      };
    }
    return {
      ...p,
      reply_count: replyCount.get(p.id) ?? 0,
      parent_excerpt,
    };
  });
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
