#!/usr/bin/env node
// Migración one-shot de la D1 (bici-db) al JSON en R2 (data/db.json).
// Lee las 4 tablas de la D1 remota (INCLUIDA la papelera: posts con
// deleted_at), las ensambla en la forma DbData de src/db/store.ts y sube el
// resultado al bucket. NO toca la D1 (solo lectura): bici-db queda intacta
// hasta que la borres a mano desde el dashboard.
//
// Uso:
//   node scripts/migrate-d1-to-r2.mjs             # dry-run: escribe db.json y muestra el resumen
//   node scripts/migrate-d1-to-r2.mjs --upload    # además lo sube al R2 REMOTO (prod)
//   node scripts/migrate-d1-to-r2.mjs --upload-local  # lo sube al R2 local (wrangler dev)

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = "db.json";

function d1Query(sql) {
  const raw = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "bici-db", "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  return parsed[0].results;
}

console.log("Leyendo bici-db (remota)…");
const posts = d1Query("SELECT * FROM posts ORDER BY id");
const media = d1Query("SELECT * FROM media ORDER BY post_id, position");
const hashtags = d1Query("SELECT * FROM hashtags ORDER BY post_id, tag");
const places = d1Query("SELECT * FROM places ORDER BY id");

const mediaByPost = new Map();
for (const m of media) {
  const arr = mediaByPost.get(m.post_id) || [];
  arr.push(m);
  mediaByPost.set(m.post_id, arr);
}
const tagsByPost = new Map();
for (const h of hashtags) {
  const arr = tagsByPost.get(h.post_id) || [];
  arr.push(h.tag);
  tagsByPost.set(h.post_id, arr);
}

const data = {
  seq: {
    post: Math.max(0, ...posts.map((p) => p.id)),
    media: Math.max(0, ...media.map((m) => m.id)),
    place: Math.max(0, ...places.map((p) => p.id)),
  },
  posts: posts.map((p) => ({
    id: p.id,
    text: p.text ?? null,
    parent_id: p.parent_id ?? null,
    created_at: p.created_at,
    deleted_at: p.deleted_at ?? null,
    location: p.location ?? null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    media: mediaByPost.get(p.id) || [],
    hashtags: tagsByPost.get(p.id) || [],
  })),
  places,
};

writeFileSync(OUT, JSON.stringify(data, null, 2));
const live = data.posts.filter((p) => p.deleted_at == null).length;
const badKeys = media.filter((m) => !String(m.r2_key).startsWith("images/"));
console.log(
  `OK → ${OUT}: ${data.posts.length} posts (${live} vivos, ${data.posts.length - live} en papelera), ` +
    `${media.length} media, ${hashtags.length} hashtags, ${places.length} places. ` +
    `seq=${JSON.stringify(data.seq)}`,
);
if (badKeys.length > 0) {
  // /r2/* solo sirve el prefijo images/: una key fuera de él quedaría inaccesible.
  console.warn(`AVISO: ${badKeys.length} media con r2_key fuera de images/:`);
  for (const m of badKeys) console.warn(`  post ${m.post_id}: ${m.r2_key}`);
}

const mode = process.argv[2];
if (mode === "--upload" || mode === "--upload-local") {
  const flag = mode === "--upload" ? "--remote" : "--local";
  console.log(`Subiendo a bici-storage/data/db.json (${flag})…`);
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", "bici-storage/data/db.json", "--file", OUT, "--content-type", "application/json", flag],
    { stdio: "inherit" },
  );
  console.log("Subido.");
} else {
  console.log("Dry-run (sin subir). Usa --upload (prod) o --upload-local (dev).");
}
