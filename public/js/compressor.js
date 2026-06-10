// ----- compresión cliente: barril -----
//
// bici solo sube imágenes. La compresión a WebP vive en compressor-image.js
// (canvas a secas); este archivo reexporta la API pública para que el resto del
// front (media.js) importe desde un único sitio.

export { compressImage } from './compressor-image.js';
