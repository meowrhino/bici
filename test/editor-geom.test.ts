import { describe, it, expect } from 'vitest';
import { clamp, cropAndScaleDims } from '../public/js/editor-geom.js';

describe('clamp', () => {
  it('acota dentro del rango', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('cropAndScaleDims', () => {
  it('no escala si cabe en maxDim', () => {
    expect(cropAndScaleDims(800, 600, 2000)).toEqual({ w: 800, h: 600 });
  });
  it('escala por el lado largo (ancho)', () => {
    expect(cropAndScaleDims(4000, 2000, 2000)).toEqual({ w: 2000, h: 1000 });
  });
  it('escala por el lado largo (alto)', () => {
    expect(cropAndScaleDims(1000, 3000, 2000)).toEqual({ w: 667, h: 2000 });
  });
});
