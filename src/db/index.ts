// Barrel del data layer. Los callers importan desde "./db" (resuelve a este
// index). Re-exportamos las funciones de cada entidad y SOLO las interfaces de
// shared.ts — los helpers de query transversales (selectByIds, attachMediaAndTags,
// etc.) quedan privados al paquete db/.
export * from "./posts";
export * from "./media";
export * from "./hashtags";
export * from "./places"; // re-exporta también la interfaz PlaceRow
export * from "./export";
export type { MediaRow, PostRow, ParentExcerpt, Post } from "./shared";
