import { useEffect, useRef, useState } from 'react';
import { getVideo } from '../lib/assets';
import { formatBytes } from '../lib/media';
import { renderProject, type RenderResult } from '../lib/render';
import { useProject } from '../store';
import { Field, Notice, Num, Section } from './controls';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ExportPanel() {
  const p = useProject();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(RenderResult & { url: string; seconds: number }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const outW = even(p.canvas.width * p.exportScale);
  const outH = even(p.canvas.height * p.exportScale);
  const length = p.trim.out - p.trim.in;

  const render = async () => {
    const video = getVideo(p.recording?.assetId);
    if (!video) return;
    setError(null);
    setResult(null);
    setProgress(0);
    abortRef.current = new AbortController();
    const startedAt = performance.now();
    try {
      const r = await renderProject({
        project: useProject.getState(),
        video: video.blob,
        trim: p.trim,
        scale: p.exportScale,
        fps: p.exportFps,
        bitrate: p.exportBitrateMbps * 1e6,
        onProgress: setProgress,
        signal: abortRef.current.signal,
      });
      setResult({ ...r, url: URL.createObjectURL(r.blob), seconds: (performance.now() - startedAt) / 1000 });
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') setError(`Render failed: ${(err as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  const fileName = () => {
    let host = 'recording';
    try {
      host = new URL(p.url).hostname.replace(/^www\./, '') || host;
    } catch {
      /* imported file, no URL */
    }
    return `${host}-${result?.width}x${result?.height}.${result?.extension}`;
  };

  return (
    <Section title="Export">
      <Field label="Size">
        <select value={p.exportScale} onChange={(e) => p.set({ exportScale: Number(e.target.value) })}>
          {[1, 0.75, 0.5, 0.25].map((s) => (
            <option key={s} value={s}>
              {s === 1 ? 'Full' : `${s * 100}%`} · {even(p.canvas.width * s)}×{even(p.canvas.height * s)}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Field label="Frame rate">
          <select value={p.exportFps} onChange={(e) => p.set({ exportFps: Number(e.target.value) })}>
            <option value={60}>60 fps</option>
            <option value={30}>30 fps</option>
          </select>
        </Field>
        <Field label="Bitrate">
          <Num value={p.exportBitrateMbps} min={1} max={100} suffix="Mbps" onChange={(exportBitrateMbps) => p.set({ exportBitrateMbps })} />
        </Field>
      </div>
      <p className="hint">
        {outW}×{outH}, {length.toFixed(2)}s, about {formatBytes((p.exportBitrateMbps * 1e6 * length) / 8)}.
      </p>

      {progress === null ? (
        <button type="button" className="primary" disabled={!p.recording} onClick={render}>
          Render video
        </button>
      ) : (
        <div className="progress">
          <progress value={progress} max={1} aria-label="Render progress" />
          <span>{Math.round(progress * 100)}%</span>
          <button type="button" className="small" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <div className="result">
          <video src={result.url} controls loop muted playsInline />
          {result.extension !== 'mp4' && (
            <Notice tone="warn">This browser has no H.264 encoder, so the export is WebM ({result.codec.toUpperCase()}) instead of MP4.</Notice>
          )}
          <p className="hint">
            {result.width}×{result.height} · {result.frames} frames · {formatBytes(result.blob.size)} · rendered in {result.seconds.toFixed(1)}s
          </p>
          <a className="button primary" href={result.url} download={fileName()}>
            Download {result.extension.toUpperCase()}
          </a>
        </div>
      )}
    </Section>
  );
}
