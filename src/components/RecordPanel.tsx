import { useEffect, useRef, useState } from 'react';
import { putAsset, removeAsset } from '../lib/assets';
import {
  CaptureError,
  captureSupported,
  captureTab,
  maxViewport,
  normalizeUrl,
  openTargetPopup,
  viewportFits,
} from '../lib/capture';
import { prepareVideo } from '../lib/media';
import { VIEWPORT_PRESETS, useProject } from '../store';
import { Field, Notice, Num, Section } from './controls';

type Phase =
  | { name: 'idle' }
  | { name: 'ready' }
  | { name: 'picking' }
  | { name: 'countdown'; left: number }
  | { name: 'recording'; elapsed: number; total: number }
  | { name: 'finishing' };

export function RecordPanel() {
  const p = useProject();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const popupRef = useRef<Window | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const url = normalizeUrl(p.url);
  const fits = viewportFits(p.viewport.width, p.viewport.height);
  const supported = captureSupported();
  const busy = phase.name !== 'idle' && phase.name !== 'ready';

  // Notice when the user closes the popup themselves.
  useEffect(() => {
    if (phase.name !== 'ready') return;
    const timer = setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setPhase({ name: 'idle' });
      }
    }, 500);
    return () => clearInterval(timer);
  }, [phase.name]);

  useEffect(() => {
    const title = document.title;
    if (phase.name === 'countdown') document.title = `${phase.left}… recording soon`;
    else if (phase.name === 'recording') document.title = '● Recording';
    return () => {
      document.title = title;
    };
  }, [phase]);

  const adopt = async (blob: Blob, extra: { displaySurface?: string; cursor?: string } = {}) => {
    const prepared = await prepareVideo(blob);
    const assetId = await putAsset(prepared.blob, 'video');
    const previous = useProject.getState().recording?.assetId;
    p.setRecording({ assetId, duration: prepared.duration, width: prepared.width, height: prepared.height, ...extra });
    if (previous) void removeAsset(previous);
  };

  const openSite = () => {
    setError(null);
    if (!url) return setError('Enter a valid http(s) URL first.');
    try {
      popupRef.current = openTargetPopup(url, p.viewport.width, p.viewport.height);
      p.set({ url });
      setPhase({ name: 'ready' });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const record = async () => {
    const popup = popupRef.current;
    if (!popup || popup.closed) return openSite();
    setError(null);
    setWarnings([]);
    abortRef.current = new AbortController();
    try {
      const result = await captureTab({
        popup,
        viewport: p.viewport,
        seconds: p.recordSeconds,
        hideCursor: p.hideCursor,
        onPhase: setPhase,
        signal: abortRef.current.signal,
      });
      await adopt(result.blob, { displaySurface: result.info.displaySurface, cursor: result.info.cursor });
      setWarnings(result.warnings);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : `Recording failed: ${(err as Error).message}`);
    } finally {
      // captureTab always closes the popup when it returns or throws after the picker.
      const stillOpen = popupRef.current && !popupRef.current.closed;
      if (!stillOpen) popupRef.current = null;
      setPhase(stillOpen ? { name: 'ready' } : { name: 'idle' });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setWarnings([]);
    setPhase({ name: 'finishing' });
    try {
      await adopt(file);
    } catch (err) {
      setError(`Could not import “${file.name}”: ${(err as Error).message}`);
    } finally {
      setPhase(popupRef.current && !popupRef.current.closed ? { name: 'ready' } : { name: 'idle' });
    }
  };

  const fitToScreen = () => {
    const max = maxViewport();
    const k = Math.min(max.width / p.viewport.width, max.height / p.viewport.height, 1);
    p.set({ viewport: { width: Math.floor(p.viewport.width * k), height: Math.floor(p.viewport.height * k) } });
  };

  const preset = VIEWPORT_PRESETS.find((v) => v.width === p.viewport.width && v.height === p.viewport.height);

  return (
    <>
      <Section title="Website">
        <Field label="URL">
          <input
            type="url"
            placeholder="https://example.com"
            value={p.url}
            disabled={busy}
            aria-invalid={p.url !== '' && !url}
            onChange={(e) => p.set({ url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && phase.name === 'idle' && openSite()}
          />
        </Field>
        {p.url !== '' && !url && <Notice tone="error">That does not look like a valid http(s) address.</Notice>}

        <Field label="Viewport">
          <select
            value={preset ? `${preset.width}x${preset.height}` : 'custom'}
            disabled={busy || phase.name === 'ready'}
            onChange={(e) => {
              const v = VIEWPORT_PRESETS.find((x) => `${x.width}x${x.height}` === e.target.value);
              if (v) p.set({ viewport: { width: v.width, height: v.height } });
            }}
          >
            {VIEWPORT_PRESETS.map((v) => (
              <option key={v.label} value={`${v.width}x${v.height}`}>
                {v.label}
              </option>
            ))}
            {!preset && <option value="custom">Custom</option>}
          </select>
        </Field>
        <div className="row">
          <Field label="Width">
            <Num value={p.viewport.width} min={320} max={7680} suffix="px" onChange={(width) => p.set({ viewport: { ...p.viewport, width: Math.round(width) } })} />
          </Field>
          <Field label="Height">
            <Num value={p.viewport.height} min={240} max={4320} suffix="px" onChange={(height) => p.set({ viewport: { ...p.viewport, height: Math.round(height) } })} />
          </Field>
        </div>
        {!fits && (
          <Notice tone="warn">
            This viewport is larger than your screen ({maxViewport().width}×{maxViewport().height} usable), so the popup will be clamped.{' '}
            <button type="button" className="link" onClick={fitToScreen}>
              Fit to screen
            </button>
          </Notice>
        )}

        <div className="row">
          <Field label="Duration">
            <Num value={p.recordSeconds} min={1} max={120} step={1} suffix="s" onChange={(recordSeconds) => p.set({ recordSeconds })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={p.hideCursor} onChange={(e) => p.set({ hideCursor: e.target.checked })} />
            Hide cursor
          </label>
        </div>
      </Section>

      <Section title="Record">
        {!supported && <Notice tone="error">Tab recording needs Chrome or Edge on desktop. You can still import a video file below.</Notice>}
        <ol className="steps">
          <li className={phase.name === 'idle' ? 'current' : 'done'}>Open the website in a popup and get it ready.</li>
          <li className={phase.name === 'ready' || phase.name === 'picking' ? 'current' : ''}>
            Click Record and pick the website under <b>Tab</b> in the browser dialog.
          </li>
          <li className={phase.name === 'countdown' || phase.name === 'recording' ? 'current' : ''}>
            After 3-2-1 the popup comes to the front. Interact for {p.recordSeconds}s.
          </li>
        </ol>
        {phase.name === 'idle' ? (
          <button type="button" className="primary" disabled={!supported || !url} onClick={openSite}>
            Open website
          </button>
        ) : (
          <button type="button" className="primary record" disabled={busy} onClick={record}>
            {phase.name === 'ready' ? '● Record' : phase.name === 'picking' ? 'Waiting for tab choice…' : phase.name === 'finishing' ? 'Processing…' : 'Recording…'}
          </button>
        )}
        {phase.name === 'ready' && (
          <button type="button" onClick={() => popupRef.current?.focus()}>
            Show website window
          </button>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        <button type="button" className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          Import a video file instead
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
          hidden
          data-testid="import-video"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </Section>

      {(phase.name === 'countdown' || phase.name === 'recording') && (
        <div className="overlay" role="status" aria-live="assertive">
          {phase.name === 'countdown' ? (
            <>
              <div className="count" key={phase.left}>
                {phase.left}
              </div>
              <p>Recording starts in the website window</p>
            </>
          ) : (
            <>
              <div className="rec-dot" />
              <p>
                Recording… {Math.max(0, phase.total - phase.elapsed).toFixed(1)}s left
              </p>
              <progress value={phase.elapsed} max={phase.total} />
            </>
          )}
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {phase.name === 'countdown' ? 'Cancel' : 'Stop now'}
          </button>
        </div>
      )}
    </>
  );
}
