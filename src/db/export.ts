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
