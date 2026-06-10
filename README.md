# bici

Un registro personal de **dónde dejas la bici**. Cada post es un sitio: una
foto, una ubicación (etiqueta + coordenadas GPS opcionales) y un texto opcional.
Hilos de respuestas, hashtags y sitios guardados (geofence que autorrellena el
nombre cuando vuelves a un punto). Protegido por contraseña: solo tú publicas.

Derivado recortado de [twoitter](https://github.com/meowrhino/twoitter): aquí se
quitaron audio, vídeo, encuestas, transcripción y el editor de recorte para
dejar lo esencial. Color de resalte: **plata** en vez del amarillo original.

## Stack

- **Cloudflare Workers** (Hono, TypeScript) — `src/`
- **D1** (SQLite) para posts/media/hashtags/places
- **R2** para las fotos (servidas vía `/r2/*`)
- Frontend **vanilla JS** (ES modules) + CSS en partials (`public/css/*.css`, enlazados por página)
- Sin framework, sin bundler.

## Desarrollo local

```bash
npm install
# secretos locales (gitignored)
printf 'PASSWORD="lo-que-quieras"\nAUTH_SECRET="%s"\n' "$(openssl rand -hex 32)" > .dev.vars
npm run db:schema        # aplica schema.sql a la D1 local
npm run dev              # wrangler dev en http://localhost:8787
```

## Despliegue (Cloudflare Workers)

```bash
npm run db:create            # crea bici-db; copia el database_id a wrangler.toml
npm run r2:create            # crea bici-storage
npm run db:schema:remote     # aplica schema.sql a la D1 de producción
npx wrangler secret put PASSWORD     # contraseña de acceso
npx wrangler secret put AUTH_SECRET  # secreto para firmar la sesión (HMAC)
npm run deploy               # despliega + activa el dominio de wrangler.toml
```

El dominio (`bici.meowrhino.studio`) se configura como `custom_domain` en
`wrangler.toml`. El repo está pensado para conectarse a **Workers Builds**: cada
push a `main` despliega solo.

## Tests

```bash
npm test    # vitest
```

## Estructura

```
src/
  index.ts          ensamblador Hono (registra las rutas en orden)
  routes/           auth, posts, places, upload, static (una función registerX por archivo)
  bindings.ts       tipos de bindings (D1/R2/ASSETS/rate-limit) + OWNER_ID
  middleware.ts     requireCsrf, rateLimit, parseId
  posts.ts          validatePostBody / persistPost (sin HTTP)
  db/               data layer D1 por entidad: posts, media, hashtags, places, export + shared (helpers) + index (barrel)
  media.ts, auth.ts, geo.ts, hashtags.ts
public/
  index.html, compose.html, login.html, places.html, aviso-legal.html
  app.js, compose.js, places.js
  js/               módulos ES (render, gallery, rails*, composer*, etc.)
  css/              partials por sección, enlazados por página (base primero)
schema.sql          esquema de la D1 (fuente única para crear la BD desde cero)
wrangler.toml       config del Worker (bindings, dominio, rate limit)
```
