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

export type CapturePhase =
  | { name: 'picking' }
  | { name: 'countdown'; left: number }
  | { name: 'recording'; elapsed: number; total: number }
  | { name: 'finishing' };

export interface CaptureOptions {
  url: string;
  viewport: { width: number; height: number };
  seconds: number;
  hideCursor: boolean;
  countdown?: number;
  onPhase: (phase: CapturePhase) => void;
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

const POPUP_NAME = 'website-recorder-target';
export const PICK_TITLE = 'Website Recorder: pick this tab';

/** Fills the still-blank popup with our own page: first "pick me" instructions, later the countdown. */
function paintPopup(popup: Window, big: string, small: string) {
  const doc = popup.document;
  doc.title = PICK_TITLE;
  doc.body.style.cssText =
    'margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
    'background:#0f0f12;color:#ececf1;font-family:system-ui,sans-serif;text-align:center;padding:0 24px;box-sizing:border-box';
  doc.body.innerHTML = '';
  const h = doc.createElement('div');
  h.textContent = big;
  h.style.cssText = `font-weight:700;line-height:1;font-size:${big.length <= 2 ? '160px' : '20px'}`;
  const s = doc.createElement('div');
  s.textContent = small;
  s.style.cssText = 'color:#9a9aa8;font-size:14px;max-width:420px';
  doc.body.append(h, s);
}

/**
 * Records a website in one go. Must be called directly from a click.
 *
 * The popup starts small and blank so it does not cover the browser's tab
 * picker. Once its tab is picked it grows to the viewport, shows the
 * countdown itself, and only then loads the website.
 */
export async function recordWebsite(opts: CaptureOptions): Promise<CaptureResult> {
  const { url, viewport, seconds, hideCursor, onPhase, signal } = opts;
  if (!captureSupported()) {
    throw new CaptureError('unsupported', 'This browser cannot record tabs. Use Chrome or Edge on desktop.');
  }
  const mimeType = pickMimeType();
  if (!mimeType) throw new CaptureError('no-recorder', 'No supported recording format in this browser.');

  const controller = typeof CaptureController !== 'undefined' ? new CaptureController() : undefined;

  // Both calls need the click's user activation, so neither may be awaited before the other starts.
  // Several of the options are Chrome-only hints that steer the picker towards tabs.
  const streamPromise = navigator.mediaDevices.getDisplayMedia({
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

  const s = screen as ScreenWithAvail;
  const availLeft = s.availLeft ?? 0;
  const availTop = s.availTop ?? 0;
  const small = { w: 460, h: 260 };
  // No `noopener`: the handle is needed to resize, navigate and close the popup.
  const popup = window.open(
    '',
    POPUP_NAME,
    `popup=yes,width=${small.w},height=${small.h},left=${availLeft + screen.availWidth - small.w - 24},top=${availTop + screen.availHeight - small.h - 80}`,
  );
  if (!popup) {
    void streamPromise.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => {});
    throw new CaptureError('popup-blocked', 'The browser blocked the popup. Allow popups for this site and try again.');
  }
  const closePopup = () => {
    try {
      popup.close();
    } catch {
      /* already gone */
    }
  };
  try {
    paintPopup(popup, 'Pick this tab', `In the share dialog, choose the tab named “${PICK_TITLE}”, then click Share.`);
  } catch {
    /* A stale popup from an earlier run that already navigated away; it still works as a target. */
  }

  onPhase({ name: 'picking' });
  let stream: MediaStream;
  try {
    stream = await streamPromise;
  } catch (err) {
    closePopup();
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new CaptureError('permission-denied', 'Recording was cancelled or permission was denied. Click Record and pick the small “pick this tab” window in the dialog.');
    }
    throw new CaptureError('failed', `Could not start the capture: ${(err as Error)?.message ?? err}`);
  }

  // Bring the picked tab (the popup) to the front; must be set right after the promise resolves.
  try {
    controller?.setFocusBehavior?.('focus-captured-surface');
  } catch {
    /* Not a tab/window capture, or decided too late. */
  }

  const track = stream.getVideoTracks()[0];
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
      `You shared a ${info.displaySurface === 'monitor' ? 'whole screen' : 'window'} instead of a tab, so the recording includes browser chrome. Record again and choose the “pick this tab” entry under “Tab”.`,
    );
  }
  if (hideCursor && info.cursor !== 'never') {
    warnings.push('This browser did not honor the “hide cursor” option for this capture, so the cursor may be visible.');
  }

  try {
    if (popup.closed) throw new CaptureError('popup-closed', 'The website window was closed before the recording started.');

    // Grow the popup so its page area is exactly the viewport, while it is still our own blank page.
    try {
      const dw = popup.outerWidth - popup.innerWidth;
      const dh = popup.outerHeight - popup.innerHeight;
      const outerW = viewport.width + dw;
      const outerH = viewport.height + dh;
      popup.moveTo(
        Math.round(availLeft + Math.max(0, (screen.availWidth - outerW) / 2)),
        Math.round(availTop + Math.max(0, (screen.availHeight - outerH) / 2)),
      );
      popup.resizeTo(outerW, outerH);
    } catch {
      /* Sizing is best effort; the check below reports the real size. */
    }
    popup.focus();

    const total = opts.countdown ?? 3;
    for (let left = total; left > 0; left--) {
      onPhase({ name: 'countdown', left });
      try {
        paintPopup(popup, String(left), 'The website loads and recording starts when this reaches zero.');
      } catch {
        /* popup navigated away already */
      }
      await sleep(1000);
      if (signal?.aborted) throw new CaptureError('permission-denied', 'Recording cancelled.');
      if (track.readyState === 'ended') throw new CaptureError('permission-denied', 'Sharing was stopped before the recording started.');
      if (popup.closed) throw new CaptureError('popup-closed', 'The website window was closed before the recording started.');
    }

    try {
      const w = popup.innerWidth;
      const h = popup.innerHeight;
      if (Math.abs(w - viewport.width) > 2 || Math.abs(h - viewport.height) > 2) {
        warnings.push(`The website window ended up ${w}×${h} instead of ${viewport.width}×${viewport.height}, most likely because it does not fit on this screen.`);
      }
    } catch {
      /* cannot read the size */
    }

    popup.location.replace(url);
    // Skip the blank flash of the navigation itself; slower loading is left for the trim handles.
    await sleep(600);

    const live = track.getSettings();
    info.width = live.width ?? info.width;
    info.height = live.height ?? info.height;
    const dpr = window.devicePixelRatio || 1;
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
      }, 50);
      // Closing the tab ends the track. `popup.closed` is not used here: sites that
      // isolate themselves (COOP) make the handle look closed while the tab is alive.
      track.addEventListener('ended', onEnded);
      signal?.addEventListener('abort', finish);
    });

    onPhase({ name: 'finishing' });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (endedEarly) warnings.push('The recording ended early because sharing stopped or the website window was closed.');
    if (popup.closed && !endedEarly) {
      warnings.push('This website cut its link to the recorder, so its window could not be closed automatically. Close it yourself.');
    }

    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (!blob.size) throw new CaptureError('empty', 'The recording is empty. Try again and keep the website window open.');
    return { blob, info, warnings };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    closePopup();
    window.focus();
  }
}
