import type { Context, Next } from "hono";
import type { Bindings, RateLimit } from "./bindings";

// Parsea un :id de ruta a entero positivo estricto. null si no es válido (rechaza
// "5abc", "", "-1", "1.5" o ids fuera del rango seguro) → el caller responde 400.
export function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// CSRF: writes require a custom header that HTML forms cannot set, so cross-site
// form POSTs (even from same-site subdomains via fetch without CORS allowance)
// cannot reach these endpoints.
export function requireCsrf() {
  return async (c: Context, next: Next) => {
    if (c.req.header("x-bici-csrf") !== "1") {
      return c.json({ error: "csrf" }, 403);
    }
    await next();
  };
}

// Rate limit por IP usando el binding nativo de Workers que se elija. Fail-open
// a propósito (no bloqueamos por un fallo del limitador) pero logueado. `pick`
// selecciona el binding del env.
export function rateLimit(pick: (env: Bindings) => RateLimit) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    try {
      const ip = c.req.header("cf-connecting-ip") || "local";
      const { success } = await pick(c.env).limit({ key: ip });
      if (!success) {
        return c.json({ error: "demasiadas peticiones, espera un momento" }, 429);
      }
    } catch (e) {
      console.error("rate limiter no disponible:", e);
    }
    await next();
  };
}
