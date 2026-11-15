import { useEffect, useRef, useState } from 'react';
import { putAsset, removeAsset } from '../lib/assets';
import {
  CaptureError,
  captureSupported,
  maxViewport,
  normalizeUrl,
  recordWebsite,
  viewportFits,
} from '../lib/capture';
import { HOSTED } from '../lib/env';
import { prepareVideo } from '../lib/media';
import { VIEWPORT_PRESETS, useProject } from '../store';
import { Field, Notice, Num, Section } from './controls';

type Phase =
  | { name: 'idle' }
  | { name: 'picking' }
  | { name: 'countdown'; left: number }
  | { name: 'recording'; elapsed: number; total: number }
  | { name: 'finishing' };

export function RecordPanel() {
  const p = useProject();
  const sample = p.recording?.sample;
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const url = normalizeUrl(p.url);
  const fits = viewportFits(p.viewport.width, p.viewport.height);
  const supported = captureSupported();
  const busy = phase.name !== 'idle';

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

  const record = async () => {
    setError(null);
    setWarnings([]);
    if (!url) return setError('Enter a valid http(s) URL first.');
    p.set({ url });
    abortRef.current = new AbortController();
    try {
      // Not awaited before this call: the popup and the share dialog both need this click.
      const result = await recordWebsite({
        url,
        viewport: p.viewport,
        seconds: p.recordSeconds,
        hideCursor: p.hideCursor,
        onPhase: setPhase,
        signal: abortRef.current.signal,
      });
      setPhase({ name: 'finishing' });
      await adopt(result.blob, { displaySurface: result.info.displaySurface, cursor: result.info.cursor });
      setWarnings(result.warnings);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : `Recording failed: ${(err as Error).message}`);
    } finally {
      setPhase({ name: 'idle' });
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
      setPhase({ name: 'idle' });
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
      {!HOSTED && (
      <Section title="Website">
        <Field label="URL">
          <input
            type="url"
            placeholder="https://example.com"
            value={p.url}
            disabled={busy}
            aria-invalid={p.url !== '' && !url}
            onChange={(e) => p.set({ url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && phase.name === 'idle' && void record()}
          />
        </Field>
        {p.url !== '' && !url && <Notice tone="error">That does not look like a valid http(s) address.</Notice>}

        <Field label="Viewport">
          <select
            value={preset ? `${preset.width}x${preset.height}` : 'custom'}
            disabled={busy}
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
      )}

      <Section title={HOSTED ? 'Recording' : 'Record'}>
        {HOSTED ? (
          <Notice tone="info">
            Recording a website needs screen capture, which this hosted page is not allowed to use. Import a screen recording here, or run the app locally to record directly.
          </Notice>
        ) : (
          <>
        {!supported && <Notice tone="error">Tab recording needs Chrome or Edge on desktop. You can still import a video file below.</Notice>}
        <ol className="steps">
              <li className={phase.name === 'idle' || phase.name === 'picking' ? 'current' : ''}>
                Click Record. A small window opens and the browser asks what to share: pick <b>“Website Recorder: pick this tab”</b> under Tab.
              </li>
              <li className={phase.name === 'countdown' ? 'current' : ''}>That window grows to the viewport and counts down 3-2-1.</li>
              <li className={phase.name === 'recording' ? 'current' : ''}>
                The website loads in it. Interact for {p.recordSeconds}s; it closes by itself.
              </li>
            </ol>
            <button type="button" className="primary record" disabled={!supported || !url || busy} onClick={record}>
              {phase.name === 'idle'
                ? '● Record'
                : phase.name === 'picking'
                  ? 'Waiting for tab choice…'
                  : phase.name === 'finishing'
                    ? 'Processing…'
                    : 'Recording…'}
            </button>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        <button type="button" className={HOSTED ? 'primary' : 'ghost'} disabled={busy} onClick={() => fileRef.current?.click()}>
          {phase.name === 'finishing' && HOSTED ? 'Importing…' : HOSTED ? 'Import a video file' : 'Import a video file instead'}
        </button>
        {HOSTED && sample && <p className="hint">The clip on the canvas is a sample. Importing replaces it.</p>}
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
