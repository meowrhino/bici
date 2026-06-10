// ----- auth check + visibilidad anon/authed -----

import { $, $$ } from './utils.js';
import { SIDEBAR_KEY, MEDIA_LIMITS, savedPlaces } from './state.js';
import { api } from './api.js';

// Estado interno mutable: solo lo modifica este módulo. Los demás
// preguntan vía isAuthed() (live binding también funciona, pero la
// función deja la intención más explícita en los call sites).
let IS_AUTHED = false;
export const isAuthed = () => IS_AUTHED;

export async function checkAuth() {
  const { ok, data } = await api('/api/me');
  IS_AUTHED = ok && !!data?.authed;
  // Sincroniza el tope de tamaño de imagen con el del server.
  if (data?.media) Object.assign(MEDIA_LIMITS, data.media);
  applyAuthVisibility();
  // Sitios guardados (solo authed): los usa el composer para autorrellenar el
  // nombre al capturar GPS. Fire-and-forget; un fallo no bloquea el arranque.
  if (IS_AUTHED) loadSavedPlaces();
}

async function loadSavedPlaces() {
  const { ok, data } = await api('/api/places');
  if (!ok || !Array.isArray(data)) return;
  savedPlaces.length = 0;
  savedPlaces.push(...data);
}

export function applyAuthVisibility() {
  for (const el of $$('[data-authed-only]')) el.hidden = !IS_AUTHED;
  for (const el of $$('[data-anon-only]')) el.hidden = IS_AUTHED;
  document.body.classList.toggle('anon', !IS_AUTHED);
  document.body.classList.toggle('authed', IS_AUTHED);
  // sidebar plegado por defecto, abierto solo si el usuario lo pidió
  const shown = IS_AUTHED && localStorage.getItem(SIDEBAR_KEY) === 'open';
  document.body.classList.toggle('sidebar-hidden', !shown);
  const tog = $('#toggleSidebar');
  if (tog) tog.textContent = shown ? 'ocultar #tags' : 'mostrar #tags';
}
