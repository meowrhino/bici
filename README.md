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
- **R2** para todo: las fotos bajo `images/` (servidas vía `/r2/*`) y los datos
  (posts/media/hashtags/places) como un único JSON privado en `data/db.json`.
  Sin D1: la BD entera pesa decenas de KB y escribe una sola persona, así que
  cada request carga el JSON, opera en memoria y persiste el estado completo.
  Antes de la primera escritura de cada día se guarda una copia en
  `data/backups/db-YYYY-MM-DD.json`.
- Frontend **vanilla JS** (ES modules) + CSS en partials (`public/css/*.css`, enlazados por página)
- Sin framework, sin bundler.

## Desarrollo local

```bash
npm install
# secretos locales (gitignored)
printf 'PASSWORD="lo-que-quieras"\nAUTH_SECRET="%s"\n' "$(openssl rand -hex 32)" > .dev.vars
npm run dev              # wrangler dev en http://localhost:8787
```

No hay schema que aplicar: el R2 local arranca vacío y el primer post crea
`data/db.json`. Para desarrollar con datos reales, descarga el JSON de prod y
súbelo al R2 local:

```bash
npx wrangler r2 object get bici-storage/data/db.json --remote --file db.json
npx wrangler r2 object put bici-storage/data/db.json --local --file db.json
```

## Despliegue (Cloudflare Workers)

```bash
npm run r2:create            # crea bici-storage
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
  bindings.ts       tipos de bindings (R2/ASSETS/rate-limit) + OWNER_ID
  middleware.ts     requireCsrf, rateLimit, parseId
  posts.ts          validatePostBody / persistPost (sin HTTP)
  db/               data layer (JSON en R2) por entidad: posts, media, hashtags, places, export + store (persistencia) + shared (helpers) + index (barrel)
  media.ts, auth.ts, geo.ts, hashtags.ts
public/
  index.html, compose.html, login.html, places.html, aviso-legal.html
  app.js, compose.js, places.js
  js/               módulos ES (render, gallery, rails*, composer*, etc.)
  css/              partials por sección, enlazados por página (base primero)
wrangler.toml       config del Worker (bindings, dominio, rate limit)
```
