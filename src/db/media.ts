import type { Store } from "./store";

export async function attachMedia(
  store: Store,
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
  const data = await store.data();
  const post = data.posts.find((p) => p.id === postId);
  if (!post) return;
  post.media = items.map((m, i) => ({
    id: ++data.seq.media,
    post_id: postId,
    kind: m.kind,
    r2_key: m.r2_key,
    thumb_key: m.thumb_key,
    width: m.width,
    height: m.height,
    position: i,
  }));
  await store.save();
}
