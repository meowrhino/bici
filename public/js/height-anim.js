// ----- animación de altura (WAAPI): primitiva compartida + acordeón de replies -----
//
// Animación del colapso de replies: misma curva y duración que el reply-inline
// (composer-anim.js), con el rail en lockstep, para que abrir/cerrar el hilo se
// sienta igual de fluido que abrir/cerrar el cuadro de responder. height:auto no
// es animable en CSS, así que medimos la altura natural y animamos con WAAPI.
// Duración y curva compartidas (ANIM_MS / STANDARD_CURVE en utils.js): las mismas
// que el composer inline, para que rail, acordeón y composer se muevan idénticos.

import { prefersReducedMotion, STANDARD_CURVE, ANIM_MS } from './utils.js';
import { lockstepRail, refreshActiveRail } from './rail-geometry.js';

// ¿podemos animar? (WAAPI presente y el usuario no pidió reduced-motion).
// En reduced-motion o sin WAAPI (p.ej. tests headless) caemos a toggle directo.
function canAnimateReplies(nested) {
  return typeof nested.animate === 'function' && !prefersReducedMotion();
}

// Primitiva compartida (la usan el acordeón de replies de aquí y el composer
// inline en composer-anim.js): anima una altura 0↔natural con WAAPI dejando el
// rail en lockstep, y garantiza que `onSettle` corre EXACTAMENTE una vez. El
// fallback con setTimeout es la red para pestañas en background, donde WAAPI
// (onfinish) y el ResizeObserver se pausan y el estado final no se asentaría.
//   keyframes   — pares de la animación (height/opacity; el composer suma padding/margin)
//   onSettle    — corre al terminar (onfinish/oncancel o el fallback); idempotente
//   fallback    — añade el setTimeout(duración+120) de red (animateComposerOpen no lo usa)
//   forceFinish — el fallback además llama anim.finish() para asentar la altura
//                 (el acordeón al abrir lo necesita; el resto no)
export function animateHeight(el, keyframes, { duration, easing, onSettle, fallback = true, forceFinish = false }) {
  lockstepRail(duration + 60); // el rail crece/encoge pegado a la animación
  const anim = el.animate(keyframes, { duration, easing });
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettle();
  };
  anim.onfinish = settle;
  anim.oncancel = settle;
  if (fallback) {
    setTimeout(() => {
      if (forceFinish) { try { anim.finish(); } catch { /* ya terminó */ } }
      settle();
    }, duration + 120);
  }
  return anim;
}

function animateRepliesOpen(nested) {
  // Quitamos .replies-collapsed YA (pasa a display:block) para medir la altura
  // natural; la animación la lleva de 0 a esa altura.
  nested.classList.remove('replies-collapsed');
  if (!canAnimateReplies(nested)) { refreshActiveRail(); return; }
  const h = nested.offsetHeight;
  nested._repliesAnimating = true;
  animateHeight(nested, [
    { height: '0px', opacity: 0, overflow: 'hidden' },
    { height: `${h}px`, opacity: 1, overflow: 'hidden' },
  ], {
    duration: ANIM_MS,
    easing: STANDARD_CURVE,
    forceFinish: true, // asienta la altura a natural si onfinish no llega
    onSettle: () => { nested._repliesAnimating = false; refreshActiveRail(); },
  });
}

function animateRepliesClose(nested) {
  if (!canAnimateReplies(nested)) {
    nested.classList.add('replies-collapsed');
    refreshActiveRail();
    return;
  }
  const h = nested.offsetHeight;
  nested._repliesAnimating = true;
  // .replies-collapsed se añade al TERMINAR (si no, display:none cortaría la
  // animación), vía onSettle.
  animateHeight(nested, [
    { height: `${h}px`, opacity: 1, overflow: 'hidden' },
    { height: '0px', opacity: 0, overflow: 'hidden' },
  ], {
    duration: ANIM_MS,
    easing: STANDARD_CURVE,
    onSettle: () => {
      nested.classList.add('replies-collapsed');
      nested._repliesAnimating = false;
      refreshActiveRail();
    },
  });
}

// Toggle de colapso del subárbol de replies de un BLOQUE. Colapsado por
// defecto (.replies-collapsed → display:none en CSS). Anima la altura con la
// misma curva que el reply-inline y deja el riel amarillo en lockstep. Lo usan
// el render inicial (render.js) y syncRootToggle al crear el botón.
export function bindRepliesToggle(toggle, nested) {
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    // Ignoramos clicks mientras una animación está en curso (evita solapar dos
    // height-animations sobre el mismo subárbol).
    if (nested._repliesAnimating) return;
    const wasCollapsed = nested.classList.contains('replies-collapsed');
    if (wasCollapsed) animateRepliesOpen(nested);
    else animateRepliesClose(nested);
    // Tras el toggle, expanded = estaba colapsado. El caret (▸/▾) rota ya.
    toggle.setAttribute('aria-expanded', String(wasCollapsed));
  });
}
