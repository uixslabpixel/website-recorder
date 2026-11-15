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
import { Icon, Notice, Num, Row, Section, Toggle } from './controls';

type Phase =
  | { name: 'idle' }
  | { name: 'picking' }
  | { name: 'countdown'; left: number }
  | { name: 'recording'; elapsed: number; total: number }
  | { name: 'finishing' };

export function RecordPanel() {
  const p = useProject();
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
    if (!url) return setError('Enter a valid http(s) URL.');
    p.set({ url });
    abortRef.current = new AbortController();
    try {
      const opts = {
        url,
        viewport: p.viewport,
        seconds: p.recordSeconds,
        hideCursor: p.hideCursor,
        onPhase: setPhase,
        signal: abortRef.current.signal,
      };
      // Not awaited before this call: the popup and the share dialog both need this click.
      const result = await recordWebsite(opts);
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
  const invalid = p.url !== '' && !url;

  const importButton = (
    <button type="button" className={HOSTED ? 'primary wide' : 'ghost wide'} disabled={busy} onClick={() => fileRef.current?.click()}>
      <Icon name="upload" />
      {phase.name === 'finishing' && HOSTED ? 'Importing…' : 'Import video'}
    </button>
  );

  return (
    <>
      {HOSTED ? (
        <Section title="Video" tip="Recording needs screen capture, which this hosted page cannot use. Run the app locally to record a website.">
          {importButton}
        </Section>
      ) : (
        <Section
          title="Record"
          tip={`Click Record and share the tab named “Website Recorder”. It counts down 3-2-1, loads your site, records ${p.recordSeconds}s and closes itself.`}
        >
          <input
            type="url"
            placeholder="https://example.com"
            aria-label="Website URL"
            value={p.url}
            disabled={busy}
            aria-invalid={invalid}
            onChange={(e) => p.set({ url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && phase.name === 'idle' && void record()}
          />
          {invalid && <Notice tone="error">Not a valid http(s) address.</Notice>}

          <Row label="Viewport">
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
          </Row>
          <div className="row">
            <span className="label">Size</span>
            <span className="control pair">
              <Num prefix="W" label="Viewport width" value={p.viewport.width} min={320} max={7680} onChange={(width) => p.set({ viewport: { ...p.viewport, width: Math.round(width) } })} />
              <Num prefix="H" label="Viewport height" value={p.viewport.height} min={240} max={4320} onChange={(height) => p.set({ viewport: { ...p.viewport, height: Math.round(height) } })} />
            </span>
          </div>
          {!fits && (
            <Notice tone="warn">
              Bigger than your screen ({maxViewport().width}×{maxViewport().height}).{' '}
              <button type="button" className="link" onClick={fitToScreen}>
                Fit
              </button>
            </Notice>
          )}
          <Row label="Duration">
            <Num value={p.recordSeconds} min={1} max={120} step={1} suffix="s" onChange={(recordSeconds) => p.set({ recordSeconds })} />
          </Row>
          <Row label="Hide cursor" tip="A request the browser may ignore for tab capture.">
            <Toggle checked={p.hideCursor} onChange={(hideCursor) => p.set({ hideCursor })} />
          </Row>

          {!supported && <Notice tone="error">Recording needs Chrome or Edge on desktop.</Notice>}
          <button type="button" className="primary wide record" disabled={!supported || !url || busy} onClick={record}>
            {phase.name === 'idle' && <span className="dot" aria-hidden />}
            {phase.name === 'idle' ? 'Record' : phase.name === 'picking' ? 'Waiting for tab…' : phase.name === 'finishing' ? 'Processing…' : 'Recording…'}
          </button>
          {phase.name === 'picking' && <Notice tone="info">In the share dialog, pick the tab “Website Recorder: pick this tab”.</Notice>}
          {importButton}
        </Section>
      )}

      {(error || warnings.length > 0) && (
        <div className="notices">
          {error && <Notice tone="error">{error}</Notice>}
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}

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

      {(phase.name === 'countdown' || phase.name === 'recording') && (
        <div className="overlay" role="status" aria-live="assertive">
          {phase.name === 'countdown' ? (
            <div className="count" key={phase.left}>
              {phase.left}
            </div>
          ) : (
            <>
              <p className="rec-status">
                <span className="rec-dot" />
                {Math.max(0, phase.total - phase.elapsed).toFixed(1)}s left
              </p>
              <progress value={phase.elapsed} max={phase.total} />
            </>
          )}
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {phase.name === 'countdown' ? 'Cancel' : 'Stop'}
          </button>
        </div>
      )}
    </>
  );
}
