// ----- compresión + subida + preview local (solo imágenes) -----
//
// Flujo:
//   attachFile()  → guarda File en pending y lanza compresión async
//   submit        → uploadPendingFiles() espera a la compresión y sube
//                   el blob comprimido a R2
//
// Política "siempre comprimir": imagen via canvas WebP. La compresión arranca al
// adjuntar para aprovechar el tiempo que el usuario tarda escribiendo el post.

import { CSRF_HEADERS, MEDIA_LIMITS } from './state.js';
import { mediaKindOf, uuid } from './utils.js';
import { compressImage } from './compressor.js';
import { createPreviewItem, setItemStatus } from './preview-item.js';

// Subimos vía XHR (no fetch) para poder reportar el progreso real con
// xhr.upload.onprogress — fetch no expone progreso de subida. onProgress
// recibe un ratio 0..1. Replica lo que hacía api(): cookie de sesión
// (same-origin) + CSRF header. Devuelve el JSON del server ({ key, ... }).
function uploadBlob(blob, folder, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', blob.type);
    xhr.setRequestHeader('x-content-type', blob.type);
    xhr.setRequestHeader('x-folder', folder);
    for (const [k, v] of Object.entries(CSRF_HEADERS)) xhr.setRequestHeader(k, v);
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('upload failed: respuesta no-JSON'));
        }
      } else {
        reject(new Error('upload failed: ' + xhr.status));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('upload failed: red')));
    xhr.send(blob);
  });
}

// Sube el blob ya comprimido. Devuelve metadata para POST /api/posts.
async function uploadCompressed(compressed, onProgress) {
  const main = await uploadBlob(compressed.blob, 'images', onProgress);
  return {
    kind: 'image',
    r2_key: main.key,
    thumb_key: null,
    width: compressed.width ?? null,
    height: compressed.height ?? null,
  };
}

// Adjunta un archivo al composer: guarda el File en pending, lo previsualiza
// y lanza la compresión en background. Nada se sube a R2 hasta el submit.
//
// El estado del item evoluciona: compressing → compressed → uploading → ready.
// La promise de compresión se guarda en `compressionPromise` para que submit
// la pueda esperar si todavía está en marcha.
export async function attachFile(file, previewRoot, pending) {
  // Solo imágenes: ignoramos en silencio cualquier otro tipo (drag/drop o paste
  // de un vídeo/PDF/etc.). El <input> ya filtra con accept="image/*".
  if (mediaKindOf(file) !== 'image') {
    return;
  }

  const localId = uuid();
  const previewUrl = URL.createObjectURL(file);
  const itemEl = createPreviewItem({ localId, previewUrl });
  previewRoot.appendChild(itemEl);

  itemEl.querySelector('.remove').onclick = () => {
    const it = pending.get(localId);
    pending.delete(localId);
    itemEl.remove();
    URL.revokeObjectURL(previewUrl);
    if (it?.editedPreviewUrl) URL.revokeObjectURL(it.editedPreviewUrl);
  };

  const item = {
    file,
    previewUrl,
    kind: 'image',
    status: 'compressing',
    compressed: null,
    compressionPromise: null,
    compressionError: null,
  };
  pending.set(localId, item);

  setItemStatus(itemEl, 'compressing', { label: 'comprimiendo imagen…' });
  item.compressionPromise = runCompression(item, itemEl, localId, pending);
}

// Núcleo de compresión. Lee item.file, pinta el overlay de progreso, revalida
// el tamaño contra MEDIA_LIMITS y deja el resultado en item.compressed.
function runCompression(item, itemEl, localId, pending) {
  return compressImage(item.file)
    .then((result) => {
      if (!pending.has(localId)) return null;
      // Validación de tamaño en cliente: si tras comprimir el blob aún supera el
      // tope del server (MEDIA_LIMITS, traído por /api/me), marcamos error YA.
      // El server lo revalida igual.
      const limit = MEDIA_LIMITS.image;
      if (limit && result.blob.size > limit) {
        item.status = 'error';
        const overMB = (result.blob.size / (1024 * 1024)).toFixed(1);
        const maxMB = Math.round(limit / (1024 * 1024));
        const msg = `demasiado grande: ${overMB} MB (máx ${maxMB} MB)`;
        item.compressionError = new Error(msg);
        setItemStatus(itemEl, 'error', { message: msg });
        return null;
      }
      item.compressed = result;
      item.status = 'compressed';
      const sizeMB = (result.blob.size / (1024 * 1024)).toFixed(2);
      // Mostramos el formato resultante (webp/jpeg/png…) además del tamaño:
      // si una imagen sube SIN comprimir es porque el navegador no generó webp.
      const fmt = (result.blob.type || '').split('/')[1] || '?';
      setItemStatus(itemEl, 'compressed', { sizeMB, fmt });
      return result;
    })
    .catch((err) => {
      if (!pending.has(localId)) return null;
      console.error('compression failed', err);
      item.status = 'error';
      item.compressionError = err;
      setItemStatus(itemEl, 'error', { message: err.message || 'error al comprimir' });
      throw err;
    });
}

// Sube todos los items 'compressed' a R2 (esperando antes a que termine la
// compresión de cada uno si aún no acabó). Devuelve metadata para POST
// /api/posts. Si alguno falla, los 'ready' conservan r2_key cacheado.
export async function uploadPendingFiles(pending, previewRoot) {
  const media = [];
  for (const [localId, item] of pending.entries()) {
    if (!pending.has(localId)) continue;
    if (item.status === 'ready') {
      media.push(pickMediaFields(item));
      continue;
    }
    const itemEl = previewRoot.querySelector(`[data-local-id="${CSS.escape(localId)}"]`);

    if (item.compressionPromise && item.status === 'compressing') {
      try {
        await item.compressionPromise;
      } catch (err) {
        if (!pending.has(localId)) continue; // borrado mientras comprimía
        throw err;
      }
    }
    if (!pending.has(localId)) continue;
    if (item.status === 'error' || !item.compressed) {
      throw item.compressionError || new Error('item sin comprimir');
    }

    if (itemEl) setItemStatus(itemEl, 'uploading');
    try {
      const meta = await uploadCompressed(item.compressed, (ratio) => {
        if (itemEl) setItemStatus(itemEl, 'uploading', { percent: Math.round(ratio * 100) });
      });
      if (!pending.has(localId)) continue; // borrado durante el upload
      pending.set(localId, { ...item, ...meta, status: 'ready' });
      if (itemEl) setItemStatus(itemEl, 'ok');
      media.push(pickMediaFields(meta));
    } catch (err) {
      if (!pending.has(localId)) continue;
      if (itemEl) setItemStatus(itemEl, 'error');
      pending.set(localId, { ...item, status: 'error' });
      throw err;
    }
  }
  return media;
}

function pickMediaFields({ kind, r2_key, thumb_key, width, height }) {
  return { kind, r2_key, thumb_key, width, height };
}

// Libera todos los blob URLs creados con createObjectURL para los items aún en
// pending. Sin esto, los blobs quedan en memoria hasta recargar.
export function revokePendingUrls(pending) {
  for (const m of pending.values()) {
    if (m.previewUrl) URL.revokeObjectURL(m.previewUrl);
    if (m.editedPreviewUrl) URL.revokeObjectURL(m.editedPreviewUrl);
  }
}
