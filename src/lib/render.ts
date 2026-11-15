import { keptLength, keptSegments, outputToSource, type Range } from './edit';
import {
  MATROSKA,
  MP4,
  QTFF,
  WEBM,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { drawComposition, type CompositionProject } from './compositor';

export interface RenderOptions {
  project: CompositionProject;
  video: Blob;
  trim: { in: number; out: number };
  /** Ranges removed from inside the trim. */
  cuts?: Range[];
  /** Output size multiplier relative to the project canvas (1 = full size). */
  scale: number;
  /** 'gif' ignores the bitrate and encodes an animated GIF instead of a video. */
  format?: 'video' | 'gif';
  fps: number;
  bitrate: number;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  width: number;
  height: number;
  frames: number;
  codec: 'avc' | 'vp9' | 'vp8' | 'gif';
  extension: 'mp4' | 'webm' | 'gif';
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Picks H.264/MP4 when the browser can encode it, otherwise falls back to WebM. */
export async function pickOutputCodec(width: number, height: number, bitrate: number): Promise<'avc' | 'vp9' | 'vp8' | null> {
  for (const codec of ['avc', 'vp9', 'vp8'] as const) {
    if (await canEncodeVideo(codec, { width, height, bitrate })) return codec;
  }
  return null;
}

type Ctx = OffscreenCanvasRenderingContext2D;

/**
 * Decodes the recording at each timestamp and draws the finished composition
 * on `ctx`, yielding the frame index once it is ready to be encoded.
 */
async function* composedFrames(sink: CanvasSink, timestamps: number[], ctx: Ctx, project: CompositionProject, width: number, height: number, signal?: AbortSignal) {
  let i = 0;
  let last: OffscreenCanvas | null = null;
  for await (const decoded of sink.canvasesAtTimestamps(timestamps)) {
    if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
    // The sink can miss a timestamp (e.g. right after a cut); repeat the previous frame instead of black.
    if (decoded) {
      const src = decoded.canvas as OffscreenCanvas;
      if (!last || last.width !== src.width || last.height !== src.height) last = new OffscreenCanvas(src.width, src.height);
      last.getContext('2d')!.drawImage(src, 0, 0);
    }
    const frame = last ? { image: last, width: last.width, height: last.height } : null;
    drawComposition(ctx, project, frame, width, height);
    yield i++;
  }
}

export async function renderProject(opts: RenderOptions): Promise<RenderResult> {
  const { project, trim, fps, bitrate, onProgress, signal } = opts;
  const gif = opts.format === 'gif';
  // H.264 needs even dimensions.
  const width = even(project.canvas.width * opts.scale);
  const height = even(project.canvas.height * opts.scale);
  const segments = keptSegments(trim, opts.cuts ?? []);
  const frames = Math.max(1, Math.round(keptLength(trim, opts.cuts ?? []) * fps));

  const codec = gif ? null : await pickOutputCodec(width, height, bitrate);
  if (!gif && !codec) throw new Error('This browser cannot encode video (WebCodecs is unavailable). Use a recent Chrome or Edge.');
  const isMp4 = codec === 'avc';

  const input = new Input({ source: new BlobSource(opts.video), formats: [MP4, QTFF, WEBM, MATROSKA] });
  const output = new Output({
    format: isMp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  let started = false;

  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('The recording has no video track.');
    const origin = Math.max(0, await track.getFirstTimestamp());
    const sink = new CanvasSink(track, { poolSize: 2 });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: gif })!;
    const timestamps = Array.from({ length: frames }, (_, i) => origin + outputToSource(i / fps, segments));

    if (gif) {
      const blob = await encodeGif(sink, timestamps, ctx, project, width, height, fps, onProgress, signal);
      return { blob, width, height, frames, codec: 'gif', extension: 'gif' };
    }

    const source = new CanvasSource(canvas, { codec: codec!, bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    started = true;

    for await (const i of composedFrames(sink, timestamps, ctx, project, width, height, signal)) {
      await source.add(i / fps, 1 / fps);
      onProgress((i + 1) / frames);
    }

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The encoder produced no output.');
    return {
      blob: new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' }),
      width,
      height,
      frames,
      codec: codec!,
      extension: isMp4 ? 'mp4' : 'webm',
    };
  } catch (err) {
    if (started) await output.cancel().catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** How far a pixel may be nudged, in 0-255 levels: about the gap between neighbouring palette colours. */
const DITHER = 10;

/**
 * Ordered dithering, so gradients and shadows do not turn into bands. The
 * pattern depends only on the pixel position, so a pixel that does not change
 * keeps its colour from frame to frame and still compresses as "unchanged".
 */
function dither(data: Uint8ClampedArray, width: number) {
  for (let px = 0, i = 0; i < data.length; px++, i += 4) {
    const x = px % width;
    const y = (px - x) / width;
    const d = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * DITHER;
    data[i] += d;
    data[i + 1] += d;
    data[i + 2] += d;
  }
}

/** Frames sampled to build the shared palette. */
const PALETTE_FRAMES = 12;
/** Pixels sampled per palette frame. */
const PALETTE_SAMPLES = 60_000;
/** Palette slot reserved for "same as the previous frame". */
const TRANSPARENT = 255;

/**
 * Animated GIF with one palette for the whole clip, so colours do not flicker
 * between frames. Pixels that did not change since the previous frame are
 * written as transparent, which is what keeps a mostly static shot small.
 */
async function encodeGif(
  sink: CanvasSink,
  timestamps: number[],
  ctx: Ctx,
  project: CompositionProject,
  width: number,
  height: number,
  fps: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  // Pass 1: sample a few frames across the clip and pick 255 colours from them.
  const picks = Math.min(PALETTE_FRAMES, timestamps.length);
  const sampleTimes = Array.from({ length: picks }, (_, i) => timestamps[Math.floor((i * timestamps.length) / picks)]);
  const stride = Math.max(1, Math.floor((width * height) / PALETTE_SAMPLES));
  const perFrame = Math.ceil((width * height) / stride);
  const samples = new Uint8Array(picks * perFrame * 4);
  let filled = 0;
  for await (const i of composedFrames(sink, sampleTimes, ctx, project, width, height, signal)) {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let px = 0; px < width * height; px += stride) {
      samples.set(data.subarray(px * 4, px * 4 + 4), filled);
      filled += 4;
    }
    onProgress(((i + 1) / picks) * 0.1);
  }
  const palette = quantize(samples.subarray(0, filled), TRANSPARENT, { format: 'rgb565' });
  while (palette.length <= TRANSPARENT) palette.push([0, 0, 0]);

  // Pass 2: map every frame onto that palette.
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  let previous: Uint8Array | null = null;
  for await (const i of composedFrames(sink, timestamps, ctx, project, width, height, signal)) {
    const { data } = ctx.getImageData(0, 0, width, height);
    dither(data, width);
    const index = applyPalette(data, palette, 'rgb565');
    if (!previous) {
      gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
      previous = index;
    } else {
      const diff = new Uint8Array(index.length);
      for (let px = 0; px < index.length; px++) diff[px] = index[px] === previous[px] ? TRANSPARENT : index[px];
      gif.writeFrame(diff, width, height, { delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
      previous = index;
    }
    onProgress(0.1 + ((i + 1) / timestamps.length) * 0.9);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
