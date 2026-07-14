import { isLive } from "./shared";
import type { Store } from "./store";

// Solo posts vivos: el resto de queries filtran deleted_at IS NULL; el export
// respeta el mismo contrato. Mantiene la forma plana (posts/media/hashtags/
// places como tablas) de los exports históricos de la época D1.
export async function exportAll(store: Store) {
  const data = await store.data();
  const live = data.posts.filter(isLive).sort((a, b) => a.id - b.id);
  return {
    exported_at: new Date().toISOString(),
    posts: live.map(({ media: _m, hashtags: _h, ...row }) => row),
    media: live.flatMap((p) => p.media),
    hashtags: live.flatMap((p) =>
      [...p.hashtags].sort().map((tag) => ({ post_id: p.id, tag })),
    ),
    places: [...data.places].sort((a, b) => a.id - b.id),
  };
}
