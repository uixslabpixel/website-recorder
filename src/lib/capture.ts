/**
 * Tab capture: the target site runs in a popup sized to the requested
 * viewport, and that popup's tab is recorded with the Screen Capture API.
 */

export class CaptureError extends Error {
  constructor(
    public code:
      | 'unsupported'
      | 'popup-blocked'
      | 'popup-closed'
      | 'permission-denied'
      | 'no-recorder'
      | 'empty'
      | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export function captureSupported() {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function' && typeof MediaRecorder !== 'undefined';
}

export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // Bare hosts get https, except local dev servers, which are almost always plain http.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname;
    if (host !== 'localhost' && !host.includes('.') && !host.includes(':')) return null;
    return url.href;
  } catch {
    return null;
  }
}

interface ScreenWithAvail extends Screen {
  availLeft?: number;
  availTop?: number;
}

/** Largest viewport a popup can have on this screen (leaves room for the popup's title/address bar). */
export function maxViewport() {
  const chrome = Math.max(60, window.outerHeight - window.innerHeight > 200 ? 90 : 60);
  return { width: screen.availWidth, height: Math.max(200, screen.availHeight - chrome) };
}

export function viewportFits(width: number, height: number) {
  const max = maxViewport();
  return width <= max.width && height <= max.height;
}

const POPUP_NAME = 'website-recorder-target';

/** Must be called from a user gesture, otherwise the popup blocker rejects it. */
export function openTargetPopup(url: string, width: number, height: number): Window {
  const s = screen as ScreenWithAvail;
  const left = Math.round((s.availLeft ?? 0) + Math.max(0, (screen.availWidth - width) / 2));
  const top = Math.round((s.availTop ?? 0) + Math.max(0, (screen.availHeight - height) / 4));
  // No `noopener`: the handle is needed to focus and close the popup later.
  const popup = window.open(url, POPUP_NAME, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) {
    throw new CaptureError('popup-blocked', 'The browser blocked the popup. Allow popups for this site and try again.');
  }
  return popup;
}

export interface CaptureInfo {
  displaySurface?: string;
  cursor?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  mimeType: string;
}

export interface CaptureResult {
  blob: Blob;
  info: CaptureInfo;
  warnings: string[];
}

export interface CaptureOptions {
  popup: Window;
  viewport: { width: number; height: number };
  seconds: number;
  hideCursor: boolean;
  countdown?: number;
  onPhase: (phase: { name: 'picking' } | { name: 'countdown'; left: number } | { name: 'recording'; elapsed: number; total: number } | { name: 'finishing' }) => void;
  signal?: AbortSignal;
}

const MIME_CANDIDATES = [
  // H.264 first: it is usually hardware accelerated, which matters at 60fps.
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/mp4;codecs=avc1.640033',
  'video/webm',
  'video/mp4',
];

function pickMimeType() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FocusController {
  setFocusBehavior?: (behavior: 'focus-captured-surface' | 'no-focus-change') => void;
}
declare const CaptureController: (new () => FocusController) | undefined;

export async function captureTab(opts: CaptureOptions): Promise<CaptureResult> {
  const { popup, viewport, seconds, hideCursor, onPhase, signal } = opts;
  if (!captureSupported()) {
    throw new CaptureError('unsupported', 'This browser cannot record tabs. Use Chrome or Edge on desktop.');
  }
  if (popup.closed) throw new CaptureError('popup-closed', 'The website window was closed. Open it again.');
  const mimeType = pickMimeType();
  if (!mimeType) throw new CaptureError('no-recorder', 'No supported recording format in this browser.');

  const dpr = window.devicePixelRatio || 1;
  const controller = typeof CaptureController !== 'undefined' ? new CaptureController() : undefined;

  onPhase({ name: 'picking' });
  let stream: MediaStream;
  try {
    // Several of these are Chrome-only hints that steer the picker towards tabs.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
        frameRate: { ideal: 60 },
        cursor: hideCursor ? 'never' : 'always',
      },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
      preferCurrentTab: false,
      controller,
    } as DisplayMediaStreamOptions);
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new CaptureError('permission-denied', 'Recording was cancelled or permission was denied. Click Record and pick the website tab.');
    }
    throw new CaptureError('failed', `Could not start the capture: ${(err as Error)?.message ?? err}`);
  }

  // Keep focus on this app during the countdown; must be set right after the promise resolves.
  try {
    controller?.setFocusBehavior?.('no-focus-change');
  } catch {
    /* Not a tab/window capture, or decided too late. */
  }

  const track = stream.getVideoTracks()[0];
  const stopStream = () => stream.getTracks().forEach((t) => t.stop());
  const settings = track.getSettings() as MediaTrackSettings & { cursor?: string };
  const info: CaptureInfo = {
    displaySurface: settings.displaySurface,
    cursor: settings.cursor,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    mimeType,
  };

  const warnings: string[] = [];
  if (info.displaySurface && info.displaySurface !== 'browser') {
    warnings.push(
      `You shared a ${info.displaySurface === 'monitor' ? 'whole screen' : 'window'} instead of a tab, so the recording includes browser chrome. Record again and choose the website under “Tab”.`,
    );
  }
  if (hideCursor && info.cursor !== 'never') {
    warnings.push('This browser did not honor the “hide cursor” option for this capture, so the cursor may be visible.');
  }

  try {
    const total = opts.countdown ?? 3;
    for (let left = total; left > 0; left--) {
      onPhase({ name: 'countdown', left });
      await sleep(1000);
      if (signal?.aborted) throw new CaptureError('permission-denied', 'Recording cancelled.');
      if (track.readyState === 'ended') throw new CaptureError('permission-denied', 'Sharing was stopped before the recording started.');
      if (popup.closed) throw new CaptureError('popup-closed', 'The website window was closed before the recording started.');
    }

    // Report the size once frames are flowing; before that it can be the ideal, not the real one.
    const live = track.getSettings();
    info.width = live.width ?? info.width;
    info.height = live.height ?? info.height;
    if (info.displaySurface === 'browser' && info.width && info.height) {
      const expectedAspect = viewport.width / viewport.height;
      if (Math.abs(info.width / info.height - expectedAspect) / expectedAspect > 0.03) {
        warnings.push(
          `The captured tab is ${info.width}×${info.height}, which does not match the ${viewport.width}×${viewport.height} viewport. The popup was probably clamped to your screen, or a different tab was picked.`,
        );
      }
    }

    const pixels = (info.width ?? viewport.width * dpr) * (info.height ?? viewport.height * dpr);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.round(Math.min(80e6, Math.max(16e6, pixels * 12))),
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (e) => reject(new CaptureError('failed', `Recorder error: ${(e as ErrorEvent).message ?? 'unknown'}`));
    });

    popup.focus();
    recorder.start(1000);
    const startedAt = performance.now();
    let endedEarly = false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearInterval(tick);
        track.removeEventListener('ended', onEnded);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const onEnded = () => {
        endedEarly = true;
        finish();
      };
      const tick = setInterval(() => {
        const elapsed = (performance.now() - startedAt) / 1000;
        onPhase({ name: 'recording', elapsed: Math.min(elapsed, seconds), total: seconds });
        if (elapsed >= seconds) finish();
        else if (popup.closed) onEnded();
      }, 50);
      track.addEventListener('ended', onEnded);
      signal?.addEventListener('abort', finish);
    });

    onPhase({ name: 'finishing' });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (endedEarly) warnings.push('The recording ended early because sharing stopped or the website window was closed.');

    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (!blob.size) throw new CaptureError('empty', 'The recording is empty. Try again and keep the website window open.');
    return { blob, info, warnings };
  } finally {
    stopStream();
    if (!popup.closed) popup.close();
    window.focus();
  }
}
