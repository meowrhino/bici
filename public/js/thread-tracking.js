// ----- bookkeeping del thread: contador "N resp", toggle y notificación -----
//
// Aquí vive el bookkeeping cross-thread (contador "N resp",
// notifyThreadChanged). render.js sólo renderiza y gestiona la activación;
// nos delega todo lo que toca el rail.

import { fmt } from './utils.js';
import { refreshHashtags } from './hashtags.js';
import { markExtendsToBottom } from './rail-geometry.js';
import { bindRepliesToggle } from './height-anim.js';

// ----- contenedor lógico del thread -----

// Contenedor lógico del thread para un .post: el .thread ancestro (o null si no
// está en un thread). (Antes contemplaba el #replies de la vista single-post, ya
// eliminada — la TL es un carrete plano.)
export function getThreadRoot(postEl) {
  return postEl.closest('.thread');
}

// ----- contador "N resp" -----

// Actualiza el contador "N resp" en el footer de un .post tras add/delete.
// El número se guarda en dataset.replyCount (no se parsea del texto, que va
// con formato es-ES "1.032").
export function updateReplyCount(postEl, delta) {
  if (!postEl) return;
  const current = parseInt(postEl.dataset.replyCount || '0') || 0;
  const next = Math.max(0, current + delta);
  postEl.dataset.replyCount = String(next);

  // Acordeón: CUALQUIER nivel usa el toggle "N respuestas" que colapsa/expande
  // su propio subárbol (antes los anidados usaban un enlace .resp-count; ahora
  // todos pliegan). syncRootToggle crea/actualiza/elimina el botón según el
  // count y bindea el colapso de su .thread-replies — sirve para root y anidado.
  syncRootToggle(postEl, next);
}

// Asegura que el foot de un root tenga el .resp-toggle correcto reflejando su
// nº de replies y el estado (colapsado/expandido) de su subárbol. Crea y cablea
// el botón si falta (caso: primera reply a un root, que antes dejaba un
// .resp-count incoherente), lo actualiza, o lo elimina si llega a 0. Limpia
// cualquier .resp-count residual — los roots no lo usan.
function syncRootToggle(rootPostEl, count) {
  const foot = rootPostEl.querySelector(':scope > .post-body > .post-foot');
  if (!foot) return;
  foot.querySelector('a.resp-count')?.remove();
  const nested = rootPostEl.querySelector(':scope > .thread-replies');
  let toggle = foot.querySelector('.resp-toggle');
  if (count === 0 || !nested) { toggle?.remove(); return; }
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'resp-toggle';
    foot.appendChild(toggle);
    bindRepliesToggle(toggle, nested);
  }
  toggle.setAttribute('aria-expanded', String(!nested.classList.contains('replies-collapsed')));
  toggle.textContent = `${fmt(count)} ${count === 1 ? 'respuesta' : 'respuestas'}`;
}

// ----- notificación de cambios en el thread -----

// Único punto de entrada para "algo cambió en este thread": ajusta el
// contador del padre, refresca .extends-to-bottom del subtree afectado
// (los rails geométricos los reflowea el browser solo) y refresca el
// sidebar de tags.
//   parentPost  → ancestro cuyo "N resp" hay que ajustar (null si root nuevo)
//   threadRoot  → el .thread devuelto por getThreadRoot(). Null si el cambio
//                 no afecta a un thread.
//   delta       → +1 al añadir, -1 al borrar, 0 si solo es reorder
export function notifyThreadChanged({ parentPost = null, threadRoot = null, delta = 0 } = {}) {
  if (parentPost && delta) updateReplyCount(parentPost, delta);
  if (threadRoot) {
    // El root del thread es su único hijo .post directo.
    const root = threadRoot.querySelector(':scope > .post');
    if (root) markExtendsToBottom(root);
  }
  refreshHashtags();
}
