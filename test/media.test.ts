import { describe, it, expect } from 'vitest';
import { buildMediaKey, classifyContentType, maxBytesFor } from '../src/media';

describe('classifyContentType', () => {
  it('classifies common image types', () => {
    expect(classifyContentType('image/jpeg')).toEqual({ kind: 'image', ext: 'jpg' });
    expect(classifyContentType('image/png')).toEqual({ kind: 'image', ext: 'png' });
    expect(classifyContentType('image/gif')).toEqual({ kind: 'image', ext: 'gif' });
    expect(classifyContentType('image/webp')).toEqual({ kind: 'image', ext: 'webp' });
    expect(classifyContentType('image/avif')).toEqual({ kind: 'image', ext: 'avif' });
  });

  it('rejects non-image content types (solo imágenes)', () => {
    expect(classifyContentType('video/mp4')).toBeNull();
    expect(classifyContentType('audio/webm')).toBeNull();
    expect(classifyContentType('application/pdf')).toBeNull();
    expect(classifyContentType('text/plain')).toBeNull();
    expect(classifyContentType('image/svg+xml')).toBeNull();
    expect(classifyContentType('')).toBeNull();
  });
});

describe('buildMediaKey', () => {
  it('starts with folder + year/month path', () => {
    const k = buildMediaKey('images', 'jpg');
    expect(k).toMatch(/^images\/\d{2}\/\d{2}\//);
  });

  it('uses 12 random bytes hex (24 chars) + ext', () => {
    const k = buildMediaKey('videos', 'mp4');
    expect(k).toMatch(/^videos\/\d{2}\/\d{2}\/[0-9a-f]{24}\.mp4$/);
  });

  it('sanitizes ext: strips non-alphanumeric', () => {
    const k = buildMediaKey('thumbs', '../evil.sh');
    // sólo letras/números: "evilsh"
    expect(k).toMatch(/\.evilsh$/);
  });

  it('falls back to "bin" if ext sanitizes to empty', () => {
    const k = buildMediaKey('images', '...');
    expect(k).toMatch(/\.bin$/);
  });

  it('lowercases the ext', () => {
    const k = buildMediaKey('images', 'JPG');
    expect(k).toMatch(/\.jpg$/);
  });

  it('produces different keys on consecutive calls (randomness)', () => {
    const a = buildMediaKey('images', 'jpg');
    const b = buildMediaKey('images', 'jpg');
    expect(a).not.toBe(b);
  });
});

describe('maxBytesFor', () => {
  // bici solo sube imágenes: 10 MB es el cap tras la compresión cliente a WebP.
  it('caps images at 10 MB', () => {
    expect(maxBytesFor('image')).toBe(10 * 1024 * 1024);
  });
});
