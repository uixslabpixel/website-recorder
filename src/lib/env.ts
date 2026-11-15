/** True in the single-file build published as a hosted page, where screen capture and popups are not allowed. */
export const HOSTED = import.meta.env.VITE_HOSTED === '1';

interface Downloads {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

declare global {
  interface Window {
    claude?: { use(name: 'downloads'): Promise<Downloads | null> };
    __SAMPLE_VIDEO__?: string;
  }
}

/** Saves a file: through the host's save prompt when embedded, otherwise a normal browser download. */
export async function saveFile(blob: Blob, filename: string): Promise<'saved' | 'declined' | 'unavailable'> {
  if (window.claude?.use) {
    const downloads = await window.claude.use('downloads');
    if (!downloads) return 'unavailable';
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (err) {
      return (err as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  if (HOSTED) return 'unavailable';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

export function sampleVideo(): Blob | null {
  const b64 = window.__SAMPLE_VIDEO__;
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'video/webm' });
}
