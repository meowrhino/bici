import { haversineMeters } from "../geo";
import type { Store } from "./store";

export interface PlaceRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  owner: string;
  created_at: string;
}

export async function listPlaces(store: Store): Promise<PlaceRow[]> {
  const data = await store.data();
  return [...data.places].sort((a, b) => a.id - b.id);
}

export async function createPlace(
  store: Store,
  name: string,
  lat: number,
  lng: number,
  radius = 150,
  owner = "me",
): Promise<PlaceRow> {
  const data = await store.data();
  const place: PlaceRow = {
    id: ++data.seq.place,
    name,
    lat,
    lng,
    radius,
    owner,
    created_at: new Date().toISOString(),
  };
  data.places.push(place);
  await store.save();
  return place;
}

// Renombra / ajusta el radio de un sitio, SOLO si pertenece a `owner`.
export async function updatePlace(
  store: Store,
  id: number,
  fields: { name: string; radius: number },
  owner = "me",
): Promise<PlaceRow | null> {
  const data = await store.data();
  const place = data.places.find((p) => p.id === id && p.owner === owner);
  if (!place) return null;
  place.name = fields.name;
  place.radius = fields.radius;
  await store.save();
  return place;
}

export async function deletePlace(
  store: Store,
  id: number,
  owner = "me",
): Promise<boolean> {
  const data = await store.data();
  const idx = data.places.findIndex((p) => p.id === id && p.owner === owner);
  if (idx === -1) return false;
  data.places.splice(idx, 1);
  await store.save();
  return true;
}

// Devuelve el primer sitio guardado cuyo radio contiene el punto dado, o null.
export async function findNearbyPlace(
  store: Store,
  lat: number,
  lng: number,
): Promise<PlaceRow | null> {
  const places = await listPlaces(store);
  for (const p of places) {
    if (haversineMeters(lat, lng, p.lat, p.lng) <= p.radius) return p;
  }
  return null;
}
