// R2Bucket fake en memoria para tests de backend en node. Cubre la superficie
// que usa el Store (src/db/store.ts) y la ruta /r2/*:
//   get(key)  → { json, text, arrayBuffer, body, httpEtag, writeHttpMetadata }
//   put(key, value, opts?)
//   head(key) → truthy si existe (el backup diario del Store lo usa)
//
// Sustituye al viejo adapter D1 sobre better-sqlite3: ya no hay SQL que
// replicar, la "BD" es un JSON en el bucket.
import { Store } from '../../src/db/store';

export class MemR2Bucket {
  private map = new Map<string, Uint8Array>();

  async get(key: string) {
    const bytes = this.map.get(key);
    if (!bytes) return null;
    const text = () => Promise.resolve(new TextDecoder().decode(bytes));
    return {
      json: async () => JSON.parse(await text()),
      text,
      arrayBuffer: async () => bytes.slice().buffer,
      body: new Blob([bytes.slice()]).stream(),
      httpEtag: `"${key}"`,
      writeHttpMetadata: (_h: Headers) => {},
    };
  }

  async put(key: string, value: string | ArrayBuffer | Uint8Array, _opts?: unknown) {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value.slice()
          : new Uint8Array(value.slice(0));
    this.map.set(key, bytes);
    return {};
  }

  async head(key: string) {
    return this.map.has(key) ? {} : null;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

export function makeBucket(): R2Bucket {
  return new MemR2Bucket() as unknown as R2Bucket;
}

// Store fresco sobre un bucket vacío — el equivalente al viejo makeTestDb().
export function makeTestStore(): Store {
  return new Store(makeBucket());
}
