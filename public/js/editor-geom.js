// ----- geometría de imagen (sin DOM) -----
//
// Helpers matemáticos puros que usa la compresión de imagen
// (compressor-image.js). Sin DOM → testeables con vitest sin navegador.

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// Escala unas dimensiones para que el lado largo no pase de maxDim, manteniendo
// el aspect ratio. Devuelve las dims del canvas destino.
export function cropAndScaleDims(sw, sh, maxDim) {
  let w = sw;
  let h = sh;
  if (sw > maxDim || sh > maxDim) {
    const r = sw > sh ? maxDim / sw : maxDim / sh;
    w = Math.round(sw * r);
    h = Math.round(sh * r);
  }
  return { w, h };
}
