// Persistencia de bici: un único JSON en R2 (data/db.json) en vez de D1.
// La BD entera pesa decenas de KB y escribe una sola persona, así que el patrón
// carga-todo → muta en memoria → guarda-todo es la herramienta proporcional:
// sin SQL, sin límites de parámetros, sin CTEs. Última escritura gana (no hay
// escritores concurrentes).
//
// El Store se crea POR REQUEST (storeFrom): cachea el JSON en la primera
// lectura y cada mutación persiste el estado completo, así varias operaciones
// del mismo request (crear post + media + hashtags + place) son acumulativas.

import type { PlaceRow } from "./places";
import type { MediaRow, PostRow } from "./shared";

// Post tal y como se guarda: la fila + sus media y hashtags embebidos (en SQL
// eran tablas aparte; en JSON lo natural es anidarlos).
export interface StoredPost extends PostRow {
  deleted_at: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  media: MediaRow[];
  hashtags: string[];
}

export interface DbData {
  // Contadores autoincrementales (sustituyen a AUTOINCREMENT). Nunca se
  // recalculan de max(id): un post borrado del todo no debe liberar su id.
  seq: { post: number; media: number; place: number };
  posts: StoredPost[];
  places: PlaceRow[];
}

// Bajo data/ para que quede FUERA del prefijo público images/ que sirve /r2/*
// (el JSON contiene la papelera y las coords de tus sitios — nunca público).
export const DB_KEY = "data/db.json";

export function emptyData(): DbData {
  return { seq: { post: 0, media: 0, place: 0 }, posts: [], places: [] };
}

export class Store {
  private cache: DbData | null = null;
  private backupChecked = false;

  constructor(private bucket: R2Bucket) {}

  async data(): Promise<DbData> {
    if (!this.cache) {
      const obj = await this.bucket.get(DB_KEY);
      this.cache = obj ? ((await obj.json()) as DbData) : emptyData();
    }
    return this.cache;
  }

  // Persiste el estado completo. Antes de la PRIMERA escritura del día copia el
  // JSON actual a data/backups/db-YYYY-MM-DD.json: es lo que sustituye al Time
  // Travel de D1. En try/catch porque un fallo del backup no debe bloquear la
  // escritura.
  async save(): Promise<void> {
    const data = await this.data();
    if (!this.backupChecked) {
      this.backupChecked = true;
      try {
        const day = new Date().toISOString().slice(0, 10);
        const backupKey = `data/backups/db-${day}.json`;
        if (!(await this.bucket.head(backupKey))) {
          const current = await this.bucket.get(DB_KEY);
          if (current) {
            await this.bucket.put(backupKey, await current.arrayBuffer(), {
              httpMetadata: { contentType: "application/json" },
            });
          }
        }
      } catch (err) {
        console.error("backup diario falló:", err);
      }
    }
    await this.bucket.put(DB_KEY, JSON.stringify(data), {
      httpMetadata: { contentType: "application/json" },
    });
  }
}

export function storeFrom(env: { STORAGE: R2Bucket }): Store {
  return new Store(env.STORAGE);
}
