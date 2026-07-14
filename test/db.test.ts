// Tests de backend del data layer (src/db/) contra el Store real sobre un R2
// fake en memoria. Cubren el carrete plano (listPosts devuelve roots + replies),
// parent_excerpt, cursor, getReplies y el soft-delete en cascada + restore.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestStore } from './helpers/r2';
import type { Store } from '../src/db';
import {
  createPost,
  getPost,
  listPosts,
  getReplies,
  deletePost,
  restorePost,
  listHashtags,
  exportAll,
  createPlace,
  listPlaces,
  findNearbyPlace,
  updatePlace,
  deletePlace,
} from '../src/db';
import { syncHashtags } from '../src/hashtags';

let store: Store;
beforeEach(() => {
  store = makeTestStore();
});

describe('createPost + getPost', () => {
  it('crea un post y lo recupera con extras vacíos', async () => {
    const created = await createPost(store, 'hola mundo', null);
    expect(created.id).toBeGreaterThan(0);
    const got = await getPost(store, created.id);
    expect(got).not.toBeNull();
    expect(got!.text).toBe('hola mundo');
    expect(got!.parent_id).toBeNull();
    expect(got!.media).toEqual([]);
    expect(got!.hashtags).toEqual([]);
    expect(got!.reply_count).toBe(0);
  });

  it('getPost devuelve null para id inexistente o borrado', async () => {
    expect(await getPost(store, 9999)).toBeNull();
  });

  it('persiste y devuelve ubicación (etiqueta + coords)', async () => {
    const created = await createPost(store, 'desde la playa', null, 'Barcelona, España', 41.3851, 2.1734);
    const got = await getPost(store, created.id);
    expect(got!.location).toBe('Barcelona, España');
    expect(got!.lat).toBeCloseTo(41.3851);
    expect(got!.lng).toBeCloseTo(2.1734);
  });

  it('post sin ubicación deja location/lat/lng en null', async () => {
    const created = await createPost(store, 'sin lugar', null);
    const got = await getPost(store, created.id);
    expect(got!.location).toBeNull();
    expect(got!.lat).toBeNull();
    expect(got!.lng).toBeNull();
  });

  it('las replies arrastran su ubicación por el CTE de getReplies', async () => {
    const root = await createPost(store, 'root', null);
    await createPost(store, 'reply con sitio', root.id, 'casa', null, null);
    const replies = await getReplies(store, root.id);
    expect(replies[0].location).toBe('casa');
  });
});

describe('places (sitios guardados / geofence)', () => {
  it('createPlace + listPlaces round-trip con radio por defecto 150', async () => {
    const p = await createPlace(store, 'casa', 41.3851, 2.1734);
    expect(p.id).toBeGreaterThan(0);
    expect(p.radius).toBe(150);
    const all = await listPlaces(store);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('casa');
  });

  it('findNearbyPlace encuentra un sitio a ~44 m y NO a ~555 m', async () => {
    await createPlace(store, 'casa', 41.3851, 2.1734); // radio 150
    const near = await findNearbyPlace(store, 41.3855, 2.1734); // ~44 m
    expect(near?.name).toBe('casa');
    const far = await findNearbyPlace(store, 41.3901, 2.1734); // ~555 m
    expect(far).toBeNull();
  });

  it('findNearbyPlace devuelve null sin sitios guardados', async () => {
    expect(await findNearbyPlace(store, 41.3851, 2.1734)).toBeNull();
  });

  it('createPlace stampa owner (default "me")', async () => {
    const p = await createPlace(store, 'casa', 41.3851, 2.1734);
    expect(p.owner).toBe('me');
  });

  it('updatePlace renombra y ajusta radio si eres el dueño', async () => {
    const p = await createPlace(store, 'casa', 41.3851, 2.1734);
    const up = await updatePlace(store, p.id, { name: 'mi casa', radius: 300 }, 'me');
    expect(up?.name).toBe('mi casa');
    expect(up?.radius).toBe(300);
  });

  it('updatePlace devuelve null si no eres el dueño', async () => {
    const p = await createPlace(store, 'casa', 41.3851, 2.1734); // owner 'me'
    const up = await updatePlace(store, p.id, { name: 'hack', radius: 150 }, 'otro');
    expect(up).toBeNull();
    // y no se modificó
    expect((await listPlaces(store))[0].name).toBe('casa');
  });

  it('deletePlace borra si eres el dueño, no si no lo eres', async () => {
    const p = await createPlace(store, 'casa', 41.3851, 2.1734);
    expect(await deletePlace(store, p.id, 'otro')).toBe(false);
    expect(await listPlaces(store)).toHaveLength(1);
    expect(await deletePlace(store, p.id, 'me')).toBe(true);
    expect(await listPlaces(store)).toHaveLength(0);
  });
});

describe('listPosts (carrete plano)', () => {
  it('devuelve roots Y replies como ítems propios, cron desc', async () => {
    const a = await createPost(store, 'root A', null);
    const b = await createPost(store, 'reply a A', a.id);
    const c = await createPost(store, 'root C', null);

    const { posts } = await listPosts(store, { limit: 50 });
    const ids = posts.map((p) => p.id);
    // los 3 aparecen (incluida la reply b) — carrete plano
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toContain(c.id);
    // cron desc con desempate por id: el último creado va primero
    expect(ids[0]).toBe(c.id);
  });

  it('la reply lleva parent_excerpt con el snippet del padre', async () => {
    const a = await createPost(store, 'el padre original', null);
    const b = await createPost(store, 'la respuesta', a.id);
    const { posts } = await listPosts(store, { limit: 50 });
    const reply = posts.find((p) => p.id === b.id)!;
    expect(reply.parent_excerpt).toBeTruthy();
    expect(reply.parent_excerpt!.id).toBe(a.id);
    expect(reply.parent_excerpt!.text_snippet).toBe('el padre original');
    expect(reply.parent_excerpt!.deleted).toBe(false);
  });

  it('parent_excerpt marca deleted cuando el padre está borrado', async () => {
    const a = await createPost(store, 'padre a borrar', null);
    const b = await createPost(store, 'reply huérfana', a.id);
    // Borramos SÓLO el padre, mutando el JSON directamente: deletePost
    // cascadearía al hijo, y restorePost reviviría el batch entero. Así aislamos
    // "reply viva, padre muerto" (puede pasar en los datos aunque la API normal
    // lo evite).
    const data = await store.data();
    data.posts.find((p) => p.id === a.id)!.deleted_at = '2026-01-01T00:00:00.000Z-deadbeef';
    const { posts } = await listPosts(store, { limit: 50 });
    const reply = posts.find((p) => p.id === b.id);
    expect(reply).toBeTruthy();
    expect(reply!.parent_excerpt!.deleted).toBe(true);
  });

  it('el cursor pagina sin repetir ni saltarse posts', async () => {
    const created = [];
    for (let i = 0; i < 5; i++) created.push(await createPost(store, `post ${i}`, null));
    const page1 = await listPosts(store, { limit: 2 });
    expect(page1.posts).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listPosts(store, { limit: 2, cursor: page1.nextCursor! });
    const seen = new Set([...page1.posts, ...page2.posts].map((p) => p.id));
    expect(seen.size).toBe(4); // 2 + 2 distintos
  });

  it('filtra por texto (q)', async () => {
    await createPost(store, 'manzana', null);
    await createPost(store, 'banana', null);
    const { posts } = await listPosts(store, { limit: 50, q: 'manz' });
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe('manzana');
  });

  it('q > 200 chars se trunca, NO devuelve el feed entero (regresión)', async () => {
    await createPost(store, 'manzana', null);
    await createPost(store, 'banana', null);
    // Antes: con q.length > 200 el filtro LIKE se descartaba → devolvía TODO.
    // Ahora se trunca a 200; este patrón no aparece en ningún texto → 0 resultados.
    const huge = 'z'.repeat(300);
    const { posts } = await listPosts(store, { limit: 50, q: huge });
    expect(posts).toHaveLength(0);
  });
});

describe('getReplies', () => {
  it('devuelve el subárbol de un post (replies directas)', async () => {
    const a = await createPost(store, 'root', null);
    const b = await createPost(store, 'reply 1', a.id);
    await createPost(store, 'sub-reply', b.id); // nieto
    const replies = await getReplies(store, a.id);
    // getReplies filtra a las directas de a; el nieto cuelga de b.replies
    expect(replies.map((r) => r.id)).toEqual([b.id]);
    expect(replies[0].replies!.map((r) => r.text)).toEqual(['sub-reply']);
  });
});

describe('deletePost (soft-delete en cascada) + restorePost', () => {
  it('borra el post y sus descendientes, y desaparecen del feed', async () => {
    const a = await createPost(store, 'root', null);
    const b = await createPost(store, 'reply', a.id);
    const c = await createPost(store, 'sub-reply', b.id);
    const otro = await createPost(store, 'no relacionado', null);

    const res = await deletePost(store, a.id);
    expect(res).not.toBeNull();
    expect(new Set(res!.softDeletedIds)).toEqual(new Set([a.id, b.id, c.id]));

    const { posts } = await listPosts(store, { limit: 50 });
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids).not.toContain(c.id);
    expect(ids).toContain(otro.id); // el no relacionado sigue
  });

  it('restorePost revive el subárbol borrado en el mismo batch', async () => {
    const a = await createPost(store, 'root', null);
    const b = await createPost(store, 'reply', a.id);
    await deletePost(store, a.id);
    const restored = await restorePost(store, a.id);
    expect(new Set(restored!.restoredIds)).toEqual(new Set([a.id, b.id]));
    const { posts } = await listPosts(store, { limit: 50 });
    const ids = posts.map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('deletePost de un id inexistente devuelve null', async () => {
    expect(await deletePost(store, 9999)).toBeNull();
  });
});

describe('hashtags', () => {
  it('syncHashtags inserta y listHashtags los cuenta', async () => {
    const a = await createPost(store, 'hola #tech y #spain', null);
    await syncHashtags(store, a.id, 'hola #tech y #spain');
    const b = await createPost(store, 'otro #tech', null);
    await syncHashtags(store, b.id, 'otro #tech');
    const tags = await listHashtags(store);
    const byTag = Object.fromEntries(tags.map((t) => [t.tag, t.count]));
    expect(byTag.tech).toBe(2);
    expect(byTag.spain).toBe(1);
  });

  it('syncHashtags reemplaza los del post (no acumula)', async () => {
    const a = await createPost(store, '#uno', null);
    await syncHashtags(store, a.id, '#uno');
    await syncHashtags(store, a.id, '#dos'); // re-sync con otro tag
    const tags = (await listHashtags(store)).map((t) => t.tag);
    expect(tags).toContain('dos');
    expect(tags).not.toContain('uno');
  });
});

describe('exportAll', () => {
  it('excluye posts borrados y sus hijos huérfanos', async () => {
    const vivo = await createPost(store, 'vivo', null);
    const muerto = await createPost(store, 'a borrar', null);
    await deletePost(store, muerto.id);
    const dump = await exportAll(store);
    const ids = dump.posts.map((p: { id: number }) => p.id);
    expect(ids).toContain(vivo.id);
    expect(ids).not.toContain(muerto.id);
  });
});

describe('volumen (feed con muchos posts)', () => {
  it('listPosts arma bien el feed con 95 posts sin perder ni duplicar', async () => {
    // Herencia de la época D1 (troceado por límite de parámetros). Ya no hay
    // lotes, pero sigue verificando que un feed grande no pierde ni duplica.
    const ids = [];
    for (let i = 0; i < 95; i++) ids.push((await createPost(store, `bulk ${i}`, null)).id);
    const { posts } = await listPosts(store, { limit: 100 });
    expect(posts).toHaveLength(95);
    expect(new Set(posts.map((p) => p.id)).size).toBe(95); // sin duplicados
  });
});
