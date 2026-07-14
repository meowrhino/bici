import type { Store } from "./db";

const TAG_RE = /#([\p{L}\p{N}_]+)/gu;

export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const tags = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) {
    tags.add(m[1].toLowerCase());
  }
  return [...tags];
}

export async function syncHashtags(
  store: Store,
  postId: number,
  text: string | null,
) {
  const data = await store.data();
  const post = data.posts.find((p) => p.id === postId);
  if (!post) return;
  post.hashtags = extractHashtags(text);
  await store.save();
}
