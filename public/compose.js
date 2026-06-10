// ----- entry de la página /compose (ligera) -----
//
// Página aparte SOLO para publicar, pensada para conexiones malas: carga el
// composer (texto + foto + ubicación) SIN el timeline, render, gallery ni rails.

import { checkAuth, isAuthed } from './js/auth.js';
import { setupGlobalPasteHandler, wireComposer } from './js/composer.js';
import { toast } from './js/utils.js';

const $ = (s) => document.querySelector(s);

(async () => {
  await checkAuth();
  // Esta página es solo para publicar: si no estás logueado, al login.
  if (!isAuthed()) {
    location.href = '/login.html';
    return;
  }
  setupGlobalPasteHandler();

  wireComposer({
    form: $('#composer'),
    text: $('#text'),
    preview: $('#mediaPreview'),
    fileInput: $('#fileInput'),
    parentId: null,
    // Sin timeline que actualizar: confirmamos con un toast. wireComposer ya
    // limpia el form (texto/preview/ubicación) al publicar con éxito.
    onPosted: () => toast('publicado ✓'),
  });
})();
