// ----- composer principal + reply-inline + paste global -----

import { composerState } from './state.js';
import { api } from './api.js';
import { isAuthed } from './auth.js';
import { mediaKindOf, toast } from './utils.js';
import { attachFile, uploadPendingFiles, revokePendingUrls } from './media.js';
import { wireLocation } from './composer-location.js';

// ----- estado interno -----

// Último composer que recibió focus. Si el usuario abre un reply-inline y
// luego pierde el focus (clic fuera, scroll, etc.), seguimos recordando
// cuál era el "activo" para enrutar bien el paste.
let lastFocusedComposer = null;

// ----- cablear un composer ya existente en el DOM -----

// Engancha drop/file-input/submit a un form .composer. El paste se gestiona
// globalmente con setupGlobalPasteHandler y enruta al composer con foco.
// El estado por composer vive en composerState (WeakMap).
export function wireComposer({ form, text, preview, fileInput, parentId = null, onPosted }) {
  if (!form) return;
  const pending = new Map();
  composerState.set(form, { pending, preview });

  fileInput.addEventListener('change', async (e) => {
    for (const f of e.target.files) await attachFile(f, preview, pending);
    fileInput.value = '';
  });

  // Control de ubicación: opcional. Sólo actúa si el form trae el markup
  // (.loc-input / .geo-btn); si no, getValue() devuelve location/lat/lng null.
  const loc = wireLocation(form);

  ['dragenter', 'dragover'].forEach((ev) =>
    form.addEventListener(ev, (e) => { e.preventDefault(); form.classList.add('drag-over'); }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    form.addEventListener(ev, (e) => { e.preventDefault(); form.classList.remove('drag-over'); }),
  );
  form.addEventListener('drop', async (e) => {
    if (!isAuthed() || !e.dataTransfer) return;
    for (const f of e.dataTransfer.files) await attachFile(f, preview, pending);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = text.value.trim();
    const hasFiles = pending.size > 0;

    if (!t && !hasFiles) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    // Guardamos la etiqueta original ("publicar" o "responder") para
    // restaurarla; mientras tanto el botón muestra el estado de subida.
    const submitLabel = submitBtn?.textContent;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'publicando…';
    }
    try {
      const media = hasFiles ? await uploadPendingFiles(pending, preview) : [];
      const { location, lat, lng } = loc.getValue();
      const payload = { text: t || null, media, parent_id: parentId, location, lat, lng };
      const { ok, data: post } = await api('/api/posts', {
        method: 'POST',
        body: payload,
      });
      if (!ok) throw new Error('post failed');
      text.value = '';
      revokePendingUrls(pending);
      preview.innerHTML = '';
      pending.clear();
      loc.reset();
      onPosted(post);
    } catch (err) {
      console.error(err);
      // los items 'ready' conservan su r2_key cacheado: reintentando publicar
      // solo se vuelven a subir los que estaban en 'pending'.
      toast('error al publicar', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    }
  });
}

// ----- paste handler global -----

// Único listener para toda la página. Enruta el archivo pegado al composer
// con foco actual, o al último que tuvo foco si ya no lo tiene pero sigue
// en el DOM.
export function setupGlobalPasteHandler() {
  document.addEventListener('focusin', (e) => {
    const c = e.target.closest?.('.composer');
    if (c) lastFocusedComposer = c;
  });
  document.addEventListener('paste', async (e) => {
    if (!isAuthed() || !e.clipboardData) return;
    let formEl = document.activeElement?.closest('.composer');
    if (!formEl && lastFocusedComposer?.isConnected) {
      formEl = lastFocusedComposer;
    }
    const state = formEl && composerState.get(formEl);
    if (!state) return;
    let any = false;
    for (const item of e.clipboardData.items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (mediaKindOf(file) !== 'image') continue;
      e.preventDefault();
      await attachFile(file, state.preview, state.pending);
      any = true;
    }
    if (any) formEl.querySelector('textarea')?.focus();
  });
}
