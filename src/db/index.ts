// Barrel del data layer. Los callers importan desde "./db" (resuelve a este
// index). Re-exportamos las funciones de cada entidad, el Store (JSON en R2) y
// SOLO las interfaces de shared.ts — los helpers transversales (toPosts,
// collectDescendants, etc.) quedan privados al paquete db/.
export * from "./posts";
export * from "./media";
export * from "./hashtags";
export * from "./places"; // re-exporta también la interfaz PlaceRow
export * from "./export";
export { Store, storeFrom, DB_KEY, emptyData } from "./store";
export type { DbData, StoredPost } from "./store";
export type { MediaRow, PostRow, ParentExcerpt, Post } from "./shared";
