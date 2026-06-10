// Validación y persistencia de posts (sin HTTP). Lo usa routes/posts.ts.
// Exportado para testear la lógica aislada del transporte (test/post-handler).

import { attachMedia, createPlace, createPost, findNearbyPlace } from "./db";
import { syncHashtags } from "./hashtags";
import { OWNER_ID } from "./bindings";

// Tope de la etiqueta de ubicación (coincide con el maxlength del input). Fuente
// única: la usan la validación del post y el rename de places (PATCH).
export const LOCATION_MAX_LEN = 120;

export type PostBody = {
  text?: string | null;
  parent_id?: number | null;
  media?: Array<{
    kind: "image";
    r2_key: string;
    thumb_key?: string | null;
    width?: number | null;
    height?: number | null;
  }>;
  // Ubicación opcional: etiqueta de texto + coords (del botón "ubicación").
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type MediaInput = {
  kind: "image";
  r2_key: string;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
};

type PostValidation =
  | { ok: false; error: string; status: 400 | 404 }
  | {
      ok: true;
      text: string | null;
      media: MediaInput[];
      parentId: number | null;
      location: string | null;
      lat: number | null;
      lng: number | null;
    };

// Valida y sanea el body de un post nuevo. Devuelve los valores listos para
// persistir, o el primer error con su status. Async porque comprueba en BD que
// el parent exista.
export async function validatePostBody(
  db: D1Database,
  body: PostBody,
): Promise<PostValidation> {
  const text = (body.text ?? "").trim() || null;
  const rawMedia = body.media ?? [];

  if (!text && rawMedia.length === 0)
    return { ok: false, error: "post vacio", status: 400 };
  if (text && text.length > 4000)
    return { ok: false, error: "texto demasiado largo", status: 400 };
  // Cap de media: sin tope, un body manipulado podría spamear la tabla media.
  if (rawMedia.length > 12)
    return { ok: false, error: "demasiados adjuntos", status: 400 };
  // Validación runtime de cada media: los tipos TS no aplican en runtime y el
  // schema no tiene CHECK, así que un body manipulado podría meter basura.
  for (const m of rawMedia) {
    if (m.kind !== "image")
      return { ok: false, error: "kind de media invalido", status: 400 };
    if (typeof m.r2_key !== "string" || !m.r2_key)
      return { ok: false, error: "media sin r2_key", status: 400 };
  }

  if (body.parent_id != null) {
    const parent = await db
      .prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL")
      .bind(body.parent_id)
      .first<{ id: number }>();
    if (!parent) return { ok: false, error: "parent no existe", status: 404 };
  }

  const media: MediaInput[] = rawMedia.map((m) => ({
    kind: "image",
    r2_key: m.r2_key,
    thumb_key: m.thumb_key ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
  }));

  // Ubicación. La etiqueta se trunca a LOCATION_MAX_LEN. Las coords solo se
  // guardan si AMBAS son números válidos en rango — un map link necesita las dos.
  const location = String(body.location ?? "").trim().slice(0, LOCATION_MAX_LEN) || null;
  const { lat, lng } = parseCoords(body.lat, body.lng);

  return { ok: true, text, media, parentId: body.parent_id ?? null, location, lat, lng };
}

// Valida un par lat/lng. Devuelve ambos como número solo si los dos son finitos
// y caen en rango geográfico; en cualquier otro caso devuelve ambos null.
function parseCoords(rawLat: unknown, rawLng: unknown): { lat: number | null; lng: number | null } {
  // Solo aceptamos número o string numérico. Descarta null/undefined/""/bool/
  // objeto: sin esto, Number(null)===0 y Number(false)===0 colaban un punto
  // espurio en Null Island (0,0) para un post con solo etiqueta de texto.
  const okType = (v: unknown) => typeof v === "number" || typeof v === "string";
  if (!okType(rawLat) || !okType(rawLng) || rawLat === "" || rawLng === "")
    return { lat: null, lng: null };
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const ok =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return ok ? { lat, lng } : { lat: null, lng: null };
}

// Persiste un post ya validado (fila + media + hashtags). Devuelve el id del
// post creado.
export async function persistPost(
  db: D1Database,
  v: {
    text: string | null;
    media: MediaInput[];
    parentId: number | null;
    location: string | null;
    lat: number | null;
    lng: number | null;
  },
): Promise<number> {
  const post = await createPost(db, v.text, v.parentId, v.location, v.lat, v.lng);
  await attachMedia(db, post.id, v.media);
  await syncHashtags(db, post.id, v.text);

  // Geofence: si el post trae ubicación CON NOMBRE + coords y no hay ya un sitio
  // guardado dentro de su radio, lo guardamos para autorrellenar la próxima vez.
  // En try/catch: un fallo aquí nunca debe tumbar la publicación.
  if (v.location && v.lat != null && v.lng != null) {
    try {
      const near = await findNearbyPlace(db, v.lat, v.lng);
      if (!near) await createPlace(db, v.location, v.lat, v.lng, 150, OWNER_ID);
    } catch (err) {
      console.error("auto-save place failed:", err);
    }
  }
  return post.id;
}
