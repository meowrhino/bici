import { haversineMeters } from "../geo";

export interface PlaceRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  owner: string;
  created_at: string;
}

export async function listPlaces(db: D1Database): Promise<PlaceRow[]> {
  const res = await db
    .prepare("SELECT * FROM places ORDER BY id")
    .all<PlaceRow>();
  return res.results;
}

export async function createPlace(
  db: D1Database,
  name: string,
  lat: number,
  lng: number,
  radius = 150,
  owner = "me",
): Promise<PlaceRow> {
  const row = await db
    .prepare(
      "INSERT INTO places (name, lat, lng, radius, owner) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(name, lat, lng, radius, owner)
    .first<PlaceRow>();
  return row!;
}

// Renombra / ajusta el radio de un sitio, SOLO si pertenece a `owner`. El check
// de owner va en el WHERE para que sea atómico.
export async function updatePlace(
  db: D1Database,
  id: number,
  fields: { name: string; radius: number },
  owner = "me",
): Promise<PlaceRow | null> {
  const row = await db
    .prepare(
      "UPDATE places SET name = ?, radius = ? WHERE id = ? AND owner = ? RETURNING *",
    )
    .bind(fields.name, fields.radius, id, owner)
    .first<PlaceRow>();
  return row ?? null;
}

export async function deletePlace(
  db: D1Database,
  id: number,
  owner = "me",
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM places WHERE id = ? AND owner = ?")
    .bind(id, owner)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// Devuelve el primer sitio guardado cuyo radio contiene el punto dado, o null.
// La tabla es pequeña (single-user) → cargarla entera y filtrar en memoria basta.
export async function findNearbyPlace(
  db: D1Database,
  lat: number,
  lng: number,
): Promise<PlaceRow | null> {
  const places = await listPlaces(db);
  for (const p of places) {
    if (haversineMeters(lat, lng, p.lat, p.lng) <= p.radius) return p;
  }
  return null;
}
