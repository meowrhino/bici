// ----- galería del feed: stage + thumbs (solo imágenes) -----
//
// stage arriba (foto actual) + thumbs centradas si N>1. Click en thumb → swap
// del stage. Click en la foto del stage → lightbox (visor modal, en lightbox.js).
//
// Las primitivas compartidas con el lightbox (mediaItemHtml, readMedia,
// preloadImage, crossfadeSwap) viven en gallery-core.js. El visor modal y su
// wiring viven en lightbox.js. Aquí queda lo propio del feed.

import { escapeHtml } from './utils.js';
import { mediaItemHtml, readMedia, preloadImage, crossfadeSwap } from './gallery-core.js';
import { openLightbox, lightboxMediaFrom, setupLightbox } from './lightbox.js';

// ----- templates (sin side effects) -----

function thumbHtml(m, index, active) {
  const cls = `thumb${active ? ' is-active' : ''}`;
  const sel = active ? 'true' : 'false';
  const src = escapeHtml(m.r2_key);
  return `<button class="${cls}" type="button" role="tab" aria-selected="${sel}" data-index="${index}" aria-label="ver foto ${index + 1}">
      <img src="/r2/${src}" alt="" loading="lazy">
    </button>`;
}

// Punto de entrada usado por render.js. Devuelve el HTML completo de la galería.
// data-media lleva la lista entera (en JSON corto) para que el swap del stage y
// el lightbox no tengan que reconstruirla.
export function renderPostGallery(media) {
  if (!media || media.length === 0) return '';
  const payload = media.map((m) => ({
    k: m.kind,
    r: m.r2_key,
    t: m.thumb_key || null,
  }));
  const dataAttr = escapeHtml(JSON.stringify(payload));
  const stage = `<div class="stage" data-index="0">${mediaItemHtml(media[0])}</div>`;
  const thumbs = media.length > 1
    ? `<div class="thumbs" role="tablist">${media.map((m, i) => thumbHtml(m, i, i === 0)).join('')}</div>`
    : '';
  return `<div class="gallery" data-count="${media.length}" data-media="${dataAttr}">${stage}${thumbs}</div>`;
}

// ----- swap del stage (con preload + fade) -----

// Por galería, un contador monotónico: cada llamada coge el suyo; cuando vaya a
// pintar, si ya hay uno más nuevo en vuelo, abandona. Así clicks rápidos sólo
// muestran el último frame, sin parpadeos intermedios.
const galleryNav = new WeakMap();

export async function swapStage(galleryEl, index) {
  const media = readMedia(galleryEl);
  if (index < 0 || index >= media.length) return;
  const stage = galleryEl.querySelector(':scope > .stage');
  if (!stage) return;

  const myNav = (galleryNav.get(galleryEl) || 0) + 1;
  galleryNav.set(galleryEl, myNav);

  // Feedback inmediato en las thumbs (no esperar al fade).
  galleryEl.querySelectorAll(':scope > .thumbs > .thumb').forEach((b, i) => {
    const active = i === index;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const m = media[index];
  await crossfadeSwap(stage, {
    preload: preloadImage(`/r2/${m.r2_key}`),
    isCurrent: () => galleryNav.get(galleryEl) === myNav,
    paint: () => {
      stage.dataset.index = String(index);
      stage.innerHTML = mediaItemHtml(m);
    },
  });
}

// ----- wiring global (idempotente) -----

let wired = false;
export function setupGallery() {
  if (wired) return;
  wired = true;

  // El visor modal cablea sus propios controles/teclado/swipe.
  setupLightbox();

  document.addEventListener('click', (e) => {
    // thumb → cambiar de stage
    const thumb = e.target.closest('.gallery > .thumbs > .thumb');
    if (thumb) {
      e.stopPropagation();
      const gallery = thumb.closest('.gallery');
      swapStage(gallery, parseInt(thumb.dataset.index, 10));
      return;
    }
    // foto del stage → abrir lightbox
    const stageImg = e.target.closest('.gallery > .stage > img');
    if (stageImg) {
      e.stopPropagation();
      const stage = stageImg.parentElement;
      const gallery = stage.closest('.gallery');
      const stageIndex = parseInt(stage.dataset.index || '0', 10);
      const { visual, mappedIndex } = lightboxMediaFrom(gallery, stageIndex);
      if (visual.length > 0) openLightbox(visual, mappedIndex);
    }
  });
}
