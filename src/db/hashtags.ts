// Lectura de hashtags agregados (sidebar). El alta/sincronización de hashtags al
// publicar vive en src/hashtags.ts (syncHashtags); aquí solo el listado.
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
