// ----- clasificación y nombrado de medios (solo imágenes) -----
//
// bici guarda una foto por sitio (o varias). Solo aceptamos imágenes; el resto
// de tipos se rechaza en el upload. La compresión a WebP se hace en cliente.

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function randomKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildMediaKey(folder: "images", ext: string): string {
  const d = new Date();
  const yy = pad2(d.getFullYear() % 100);
  const mm = pad2(d.getMonth() + 1);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${folder}/${yy}/${mm}/${randomKey()}.${safeExt}`;
}

const ALLOWED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

// Tras la compresión cliente (WebP 0.85) este límite sobra. Si llega algo más
// grande es señal de que la compresión no se aplicó.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export function classifyContentType(
  ct: string,
): { kind: "image"; ext: string } | null {
  if (ALLOWED_IMAGE.has(ct)) {
    const ext = ct.split("/")[1] === "jpeg" ? "jpg" : ct.split("/")[1];
    return { kind: "image", ext };
  }
  return null;
}

export function maxBytesFor(_kind: "image"): number {
  return MAX_IMAGE_BYTES;
}
