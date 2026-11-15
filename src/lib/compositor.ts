import { getImage } from './assets';
import { RECORDING_LAYER_ID, type Background, type Project, type Transform } from '../store';

/**
 * One compositor draws both the editor preview and the exported frames, so
 * what you see in the editor is what the render produces.
 */

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type CompositionProject = Pick<
  Project,
  'canvas' | 'background' | 'recordingLayer' | 'imageLayers' | 'order' | 'recording'
>;

export function layerRect(t: Transform, aspect: number, canvasW: number, canvasH: number): Rect {
  const w = canvasW * t.scale;
  const h = w / aspect;
  return {
    x: canvasW / 2 + t.x * canvasW - w / 2,
    y: canvasH / 2 + t.y * canvasH - h / 2,
    w,
    h,
  };
}

/** Rect of a layer in canvas pixels, or null if it has nothing to draw yet. */
export function rectForLayer(id: string, p: CompositionProject, recordingSize?: { width: number; height: number }): Rect | null {
  const { width: cw, height: ch } = p.canvas;
  if (id === RECORDING_LAYER_ID) {
    const size = recordingSize ?? p.recording;
    if (!size || !size.width || !size.height) return null;
    return layerRect(p.recordingLayer, size.width / size.height, cw, ch);
  }
  const layer = p.imageLayers.find((l) => l.id === id);
  const asset = layer && getImage(layer.assetId);
  if (!layer || !asset) return null;
  return layerRect(layer, asset.width / asset.height, cw, ch);
}

function drawCover(ctx: Ctx, image: CanvasImageSource, iw: number, ih: number, w: number, h: number) {
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawBackground(ctx: Ctx, bg: Background, w: number, h: number) {
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color;
  } else if (bg.type === 'gradient') {
    // CSS-style angle: 0deg points up, 90deg points right.
    const rad = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#16161a';
  }
  ctx.fillRect(0, 0, w, h);
  if (bg.type === 'image') {
    const asset = getImage(bg.assetId);
    if (asset) drawCover(ctx, asset.bitmap, asset.width, asset.height, w, h);
  }
}

function roundedPath(ctx: Ctx, r: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
}

function drawRounded(ctx: Ctx, image: CanvasImageSource, r: Rect, radius: number) {
  ctx.save();
  roundedPath(ctx, r, radius);
  ctx.clip();
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/**
 * Draws the full composition. The context may be any pixel size; it is scaled
 * so layout always happens in project canvas units.
 */
export function drawComposition(
  ctx: Ctx,
  p: CompositionProject,
  frame: FrameSource | null,
  pixelWidth: number,
  pixelHeight: number,
) {
  const { width: cw, height: ch } = p.canvas;
  ctx.save();
  ctx.setTransform(pixelWidth / cw, 0, 0, pixelHeight / ch, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawBackground(ctx, p.background, cw, ch);

  for (const id of p.order) {
    if (id === RECORDING_LAYER_ID) {
      const size = frame ?? p.recording;
      if (!size || !size.width || !size.height) continue;
      const r = layerRect(p.recordingLayer, size.width / size.height, cw, ch);
      const rl = p.recordingLayer;
      if (rl.shadow && rl.shadowOpacity > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${rl.shadowOpacity})`;
        ctx.shadowBlur = rl.shadowBlur;
        ctx.shadowOffsetY = rl.shadowOffsetY;
        // Shadow offsets ignore the transform, so scale them by hand.
        const k = pixelWidth / cw;
        ctx.shadowBlur *= k;
        ctx.shadowOffsetY *= k;
        ctx.fillStyle = '#000';
        roundedPath(ctx, r, rl.radius);
        ctx.fill();
        ctx.restore();
      }
      if (frame) {
        drawRounded(ctx, frame.image, r, rl.radius);
      } else {
        ctx.save();
        roundedPath(ctx, r, rl.radius);
        ctx.fillStyle = '#1f1f25';
        ctx.fill();
        ctx.restore();
      }
    } else {
      const layer = p.imageLayers.find((l) => l.id === id);
      const asset = layer && getImage(layer.assetId);
      if (!layer || !asset) continue;
      drawRounded(ctx, asset.bitmap, layerRect(layer, asset.width / asset.height, cw, ch), layer.radius);
    }
  }
  ctx.restore();
}
