import {
  MATROSKA,
  MP4,
  QTFF,
  WEBM,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

export interface PreparedVideo {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
}

/**
 * MediaRecorder files have no duration or seek index, which makes scrubbing
 * unreliable. Remuxing (no re-encode) writes a proper, seekable file.
 */
export async function prepareVideo(source: Blob): Promise<PreparedVideo> {
  const input = new Input({ source: new BlobSource(source), formats: [MP4, QTFF, WEBM, MATROSKA] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no video track.');
    if (!(await track.canDecode())) throw new Error('This browser cannot decode the video codec in this file.');
    const width = track.displayWidth;
    const height = track.displayHeight;
    const start = await track.getFirstTimestamp();
    const duration = (await track.computeDuration()) - Math.max(0, start);
    if (!(duration > 0)) throw new Error('The video is empty.');

    let blob = source;
    try {
      const isWebm = (await input.getMimeType()).includes('webm') || source.type.includes('webm');
      const output = new Output({
        format: isWebm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new BufferTarget(),
      });
      const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        audio: { discard: true },
        showWarnings: false,
      });
      if (conversion.isValid) {
        await conversion.execute();
        const buffer = output.target.buffer;
        if (buffer?.byteLength) blob = new Blob([buffer], { type: isWebm ? 'video/webm' : 'video/mp4' });
      }
    } catch (err) {
      console.warn('Remux failed, using the original recording', err);
    }
    return { blob, duration, width, height };
  } finally {
    input.dispose();
  }
}

export function formatTime(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
