-- Esquema de bici (Cloudflare D1 / SQLite).
-- Cada post es un SITIO donde dejaste la bici: foto(s) + ubicación + texto.
-- Para crear la BD desde cero:
--   npm run db:create            (una vez; copia el database_id a wrangler.toml)
--   npm run db:schema            (local)
--   npm run db:schema:remote     (prod)

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    parent_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    -- Soft delete: NULL = visible; ISO timestamp = en papelera. Los assets de
    -- R2 se conservan para poder restaurar. Filtramos en listPosts/getPost.
    deleted_at TEXT,
    -- Ubicación. `location` es la etiqueta de texto que se muestra (ej. "casa",
    -- "curro"); lat/lng son coords opcionales capturadas por el botón
    -- "ubicación" (Geolocation API) para enlazar a un mapa. Pueden venir las
    -- tres, solo la etiqueta, o ninguna.
    location TEXT,
    lat REAL,
    lng REAL,
    FOREIGN KEY (parent_id) REFERENCES posts(id)
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    -- kind: hoy siempre 'image'. TEXT libre (sin CHECK) para no migrar si algún
    -- día se añade otro tipo.
    kind TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    thumb_key TEXT,
    width INTEGER,
    height INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hashtags (
    post_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (post_id, tag),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- Sitios guardados (geofence). Se autocrean al publicar con ubicación nombrada +
-- coords; el composer autorrellena el nombre cuando vuelves dentro del radio.
CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    radius REAL NOT NULL DEFAULT 150,
    owner TEXT NOT NULL DEFAULT 'me',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent_created ON posts(parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_media_post ON media(post_id, position);
CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON hashtags(tag);
