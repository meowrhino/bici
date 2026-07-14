// Lectura de hashtags agregados (sidebar). El alta/sincronización de hashtags al
// publicar vive en src/hashtags.ts (syncHashtags); aquí solo el listado.
// Solo cuenta posts vivos (la papelera no debe inflar el sidebar).
import { isLive } from "./shared";
import type { Store } from "./store";

export async function listHashtags(
  store: Store,
): Promise<Array<{ tag: string; count: number }>> {
  const data = await store.data();
  const counts = new Map<string, number>();
  for (const p of data.posts) {
    if (!isLive(p)) continue;
    for (const tag of p.hashtags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}
