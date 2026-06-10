// ----- DOM del item de preview del composer (solo imágenes) -----
//
// Construcción y estado visual de cada foto adjunta en el composer: la
// miniatura con su × y el overlay de progreso. media.js importa estas funciones.

// DOM puro: construye el item de preview con la miniatura + × + overlay para el
// estado (barra de progreso + etiqueta). El overlay se crea aquí, vacío y sin
// .visible: setItemStatus lo activa cuando hace falta.
export function createPreviewItem({ localId, previewUrl }) {
  const el = document.createElement('div');
  el.className = 'item item-image';
  el.dataset.localId = localId;
  el.innerHTML = `
    <img src="${previewUrl}">
    <button class="remove" type="button" aria-label="quitar">×</button>
    <div class="status" aria-live="polite">
      <div class="status-bar"><div class="status-bar-fill"></div></div>
      <span class="status-label"></span>
    </div>
  `;
  return el;
}

// Actualiza el overlay de estado de un item. Maneja barra + etiqueta.
// kinds: compressing | compressed | uploading | ok | error | clear.
// extra: { percent, label, sizeMB, fmt, message } según el kind.
export function setItemStatus(itemEl, kind, extra = {}) {
  const status = itemEl.querySelector('.status');
  const fill = itemEl.querySelector('.status-bar-fill');
  const label = itemEl.querySelector('.status-label');
  if (!status || !fill || !label) return;

  if (kind === 'clear') {
    status.classList.remove('visible', 'status-err', 'status-ok', 'indeterminate');
    return;
  }

  status.classList.add('visible');
  status.classList.remove('status-err', 'status-ok');

  if (kind === 'compressing') {
    if (extra.percent != null) {
      status.classList.remove('indeterminate');
      fill.style.width = `${extra.percent}%`;
      label.textContent = extra.label
        ? `${extra.label} ${extra.percent}%`
        : `comprimiendo ${extra.percent}%`;
    } else {
      status.classList.add('indeterminate');
      fill.style.width = '';
      label.textContent = extra.label || 'preparando…';
    }
  } else if (kind === 'compressed') {
    status.classList.remove('indeterminate');
    status.classList.add('status-ok');
    fill.style.width = '100%';
    const tag = extra.fmt ? `${extra.sizeMB} MB · ${extra.fmt}` : `${extra.sizeMB} MB · listo`;
    label.textContent = extra.sizeMB ? tag : 'comprimido';
  } else if (kind === 'uploading') {
    if (extra.percent != null) {
      status.classList.remove('indeterminate');
      fill.style.width = `${extra.percent}%`;
      label.textContent = `subiendo ${extra.percent}%`;
    } else {
      status.classList.add('indeterminate');
      fill.style.width = '';
      label.textContent = 'subiendo a R2…';
    }
  } else if (kind === 'ok') {
    status.classList.remove('indeterminate');
    status.classList.add('status-ok');
    fill.style.width = '100%';
    label.textContent = 'publicado';
  } else if (kind === 'error') {
    status.classList.remove('indeterminate');
    status.classList.add('status-err');
    fill.style.width = '100%';
    label.textContent = extra.message || 'error';
  }
}
