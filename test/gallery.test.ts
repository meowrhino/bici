// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderPostGallery, swapStage } from '../public/js/gallery.js';
import { openLightbox, closeLightbox } from '../public/js/lightbox.js';

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('renderPostGallery', () => {
  it('media vacío → string vacío', () => {
    expect(renderPostGallery([])).toBe('');
    expect(renderPostGallery(undefined as any)).toBe('');
  });

  it('1 imagen: stage con <img>, sin .thumbs', () => {
    const html = renderPostGallery([{ kind: 'image', r2_key: 'a.jpg' } as any]);
    const el = mount(html);
    expect(el.classList.contains('gallery')).toBe(true);
    expect(el.dataset.count).toBe('1');
    expect(el.querySelector(':scope > .stage > img')!.getAttribute('src')).toBe('/r2/a.jpg');
    expect(el.querySelector(':scope > .thumbs')).toBeNull();
  });

  it('N>1: aparecen .thumbs centradas y la primera con is-active', () => {
    const media = [
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
      { kind: 'image', r2_key: 'c.jpg' },
    ] as any[];
    const el = mount(renderPostGallery(media));
    const thumbs = el.querySelectorAll(':scope > .thumbs > .thumb');
    expect(thumbs.length).toBe(3);
    expect(thumbs[0].classList.contains('is-active')).toBe(true);
    expect(thumbs[0].getAttribute('aria-selected')).toBe('true');
    expect(thumbs[1].classList.contains('is-active')).toBe(false);
    expect((thumbs[2].querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/r2/c.jpg');
  });

  it('data-media contiene la lista en JSON (legible por dataset)', () => {
    const el = mount(renderPostGallery([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
    ] as any));
    const parsed = JSON.parse(el.dataset.media!);
    expect(parsed).toEqual([
      { k: 'image', r: 'a.jpg', t: null },
      { k: 'image', r: 'b.jpg', t: null },
    ]);
  });
});

describe('swapStage', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('cambia el stage al índice pedido y mueve is-active', async () => {
    const el = mount(renderPostGallery([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
    ] as any));
    await swapStage(el, 1);
    const stage = el.querySelector(':scope > .stage') as HTMLElement;
    expect(stage.dataset.index).toBe('1');
    expect((stage.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/r2/b.jpg');
    const thumbs = el.querySelectorAll(':scope > .thumbs > .thumb');
    expect(thumbs[0].classList.contains('is-active')).toBe(false);
    expect(thumbs[1].classList.contains('is-active')).toBe(true);
    expect(thumbs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('thumb feedback (is-active) es inmediato, sin esperar al fade', () => {
    const el = mount(renderPostGallery([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
    ] as any));
    // fire-and-forget; antes del await, el thumb activo ya debe haber cambiado.
    void swapStage(el, 1);
    const thumbs = el.querySelectorAll(':scope > .thumbs > .thumb');
    expect(thumbs[1].classList.contains('is-active')).toBe(true);
    expect(thumbs[0].classList.contains('is-active')).toBe(false);
  });

  it('índice fuera de rango → no toca el stage', async () => {
    const el = mount(renderPostGallery([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
    ] as any));
    await swapStage(el, 99);
    await swapStage(el, -1);
    const stage = el.querySelector(':scope > .stage') as HTMLElement;
    expect(stage.dataset.index).toBe('0');
    expect((stage.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/r2/a.jpg');
  });

  it('clicks rápidos: sólo el último gana (race-guard)', async () => {
    const el = mount(renderPostGallery([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
      { kind: 'image', r2_key: 'c.jpg' },
    ] as any));
    // tres swaps en seguida, sólo esperamos a que termine el último.
    void swapStage(el, 1);
    void swapStage(el, 2);
    const last = swapStage(el, 0);
    await last;
    // pequeño respiro para que los otros (en vuelo) intenten pintar y aborten.
    await new Promise((r) => setTimeout(r, 50));
    const stage = el.querySelector(':scope > .stage') as HTMLElement;
    expect(stage.dataset.index).toBe('0');
    expect((stage.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/r2/a.jpg');
  });
});

describe('lightbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    closeLightbox();
  });

  it('openLightbox con N>1 muestra contador y flechas (sincrónicamente)', () => {
    // contador/flechas se setean sincrónicamente; no hace falta await.
    void openLightbox([
      { kind: 'image', r2_key: 'a.jpg' },
      { kind: 'image', r2_key: 'b.jpg' },
    ] as any, 0);
    const lb = document.querySelector('.lightbox') as HTMLElement;
    expect(lb.hidden).toBe(false);
    expect(document.body.classList.contains('lightbox-open')).toBe(true);
    expect(lb.querySelector('.lightbox-counter')!.textContent).toBe('1 / 2');
    expect((lb.querySelector('.lightbox-prev') as HTMLElement).hidden).toBe(false);
    expect((lb.querySelector('.lightbox-next') as HTMLElement).hidden).toBe(false);
  });

  it('openLightbox con 1 item oculta flechas y contador', () => {
    void openLightbox([{ kind: 'image', r2_key: 'solo.jpg' }] as any, 0);
    const lb = document.querySelector('.lightbox') as HTMLElement;
    expect((lb.querySelector('.lightbox-prev') as HTMLElement).hidden).toBe(true);
    expect((lb.querySelector('.lightbox-next') as HTMLElement).hidden).toBe(true);
    expect(lb.querySelector('.lightbox-counter')!.textContent).toBe('');
  });

  it('openLightbox pinta el media tras el preload', async () => {
    await openLightbox([{ kind: 'image', r2_key: 'a.jpg' }] as any, 0);
    const stage = document.querySelector('.lightbox-stage') as HTMLElement;
    const img = stage.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/r2/a.jpg');
  });

  it('closeLightbox cancela cualquier render en vuelo y vacía el stage', async () => {
    // fire-and-forget el open; cerrar antes de que el preload resuelva.
    void openLightbox([{ kind: 'image', r2_key: 'a.jpg' }] as any, 0);
    closeLightbox();
    // dejar que el openLightbox en vuelo termine (debería abortar por el ++lbNav)
    await new Promise((r) => setTimeout(r, 30));
    const lb = document.querySelector('.lightbox') as HTMLElement;
    expect(lb.hidden).toBe(true);
    expect(lb.querySelector('.lightbox-stage')!.innerHTML).toBe('');
    expect(document.body.classList.contains('lightbox-open')).toBe(false);
  });
});
