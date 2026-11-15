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
import { drawComposition, type CompositionProject } from './compositor';

export interface RenderOptions {
  project: CompositionProject;
  video: Blob;
  trim: { in: number; out: number };
  /** Ranges removed from inside the trim. */
  cuts?: Range[];
  /** Output size multiplier relative to the project canvas (1 = full size). */
  scale: number;
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
  codec: 'avc' | 'vp9' | 'vp8';
  extension: 'mp4' | 'webm';
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Picks H.264/MP4 when the browser can encode it, otherwise falls back to WebM. */
export async function pickOutputCodec(width: number, height: number, bitrate: number): Promise<RenderResult['codec'] | null> {
  for (const codec of ['avc', 'vp9', 'vp8'] as const) {
    if (await canEncodeVideo(codec, { width, height, bitrate })) return codec;
  }
  return null;
}

export async function renderProject(opts: RenderOptions): Promise<RenderResult> {
  const { project, trim, fps, bitrate, onProgress, signal } = opts;
  // H.264 needs even dimensions.
  const width = even(project.canvas.width * opts.scale);
  const height = even(project.canvas.height * opts.scale);
  const segments = keptSegments(trim, opts.cuts ?? []);
  const frames = Math.max(1, Math.round(keptLength(trim, opts.cuts ?? []) * fps));

  const codec = await pickOutputCodec(width, height, bitrate);
  if (!codec) throw new Error('This browser cannot encode video (WebCodecs is unavailable). Use a recent Chrome or Edge.');
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
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    started = true;

    const timestamps = Array.from({ length: frames }, (_, i) => origin + outputToSource(i / fps, segments));
    let i = 0;
    let last: OffscreenCanvas | null = null;
    for await (const decoded of sink.canvasesAtTimestamps(timestamps)) {
      if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      // The sink can miss a timestamp (e.g. right after a cut); repeat the previous frame instead of black.
      if (decoded) {
        const src = decoded.canvas;
        if (!last || last.width !== src.width || last.height !== src.height) last = new OffscreenCanvas(src.width, src.height);
        last.getContext('2d')!.drawImage(src, 0, 0);
      }
      const frame = last ? { image: last, width: last.width, height: last.height } : null;
      drawComposition(ctx, project, frame, width, height);
      await source.add(i / fps, 1 / fps);
      i++;
      onProgress(i / frames);
    }

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The encoder produced no output.');
    return {
      blob: new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' }),
      width,
      height,
      frames,
      codec,
      extension: isMp4 ? 'mp4' : 'webm',
    };
  } catch (err) {
    if (started) await output.cancel().catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}
