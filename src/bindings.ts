// Bindings del Worker + constantes compartidas. Sin código runtime.

// Binding de rate limiting nativo (wrangler.toml [[unsafe.bindings]]).
export interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
  ASSETS: Fetcher;
  PASSWORD: string;
  AUTH_SECRET: string;
  // Usuario de acceso. Opcional: si no se define, vale "manu" (ver routes/auth).
  // No es secreto (el password sí) — solo da el par usuario+contraseña que los
  // gestores de contraseñas saben guardar y autorrellenar.
  USERNAME?: string;
  WRITE_LIMITER: RateLimit;
};

// Alias para tipar el `app` de Hono y las funciones registerX(app).
export type AppEnv = { Bindings: Bindings };

// Dueño de los sitios guardados. Hoy hay un solo usuario (auth por contraseña
// compartida) → identidad fija. Fuente única de verdad: la usan el geofence
// auto-save (persistPost) y las rutas de places.
export const OWNER_ID = "me";
