// ----- rails verticales: estructura, geometría y bookkeeping del thread -----
//
// Facade: rails.js se mantiene como punto de entrada estable para los
// consumidores (render.js, post-actions.js, inline-composer.js, pages.js,
// composer-anim.js). La implementación vive ahora en tres módulos, con la
// dependencia en una sola dirección thread-tracking → height-anim →
// rail-geometry (hoja):
//   - rail-geometry.js  — ciclo de vida + geometría del rail activo (amarillo),
//     .extends-to-bottom del rail estructural (gris), el ResizeObserver y las
//     animaciones diferidas (switch/close/lockstep). Toda la state mutable de
//     módulo (observedRoot, pendingTimers, railObserver, lockstepTimer) vive
//     ahí junta.
//   - height-anim.js    — primitiva WAAPI compartida (animateHeight) + acordeón
//     de replies.
//   - thread-tracking.js — bookkeeping cross-thread (contador "N resp",
//     notifyThreadChanged).

export {
  markExtendsToBottom,
  paintActiveRail,
  updateActiveRail,
  observeActiveRoot,
  unobserveActiveRoot,
  refreshActiveRail,
  switchActiveRail,
  scheduleRailClose,
  cancelRailClose,
  lockstepRail,
  releaseRail,
} from './rail-geometry.js';
export { animateHeight, bindRepliesToggle } from './height-anim.js';
export { getThreadRoot, updateReplyCount, notifyThreadChanged } from './thread-tracking.js';
