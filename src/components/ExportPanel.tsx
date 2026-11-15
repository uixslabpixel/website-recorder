import { keptLength } from '../lib/edit';
import { useEffect, useRef, useState } from 'react';
import { getVideo } from '../lib/assets';
import { saveFile } from '../lib/env';
import { formatBytes } from '../lib/media';
import { MIN_BITRATE, bitrateForTargetSize, renderProject, type RenderResult } from '../lib/render';
import { useProject } from '../store';
import { Field, Notice, Num, Section, Segmented } from './controls';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Extra passes allowed when a target-size export comes out over the target. */
const MAX_RETRIES = 2;
/** Bits per pixel per frame below which the picture usually looks blocky. */
const LOW_BPP = 0.02;

export function ExportPanel() {
  const p = useProject();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(RenderResult & { url: string; seconds: number; targetBytes: number | null }) | null>(null);
  const [pass, setPass] = useState(1);
  const abortRef = useRef<AbortController | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const outW = even(p.canvas.width * p.exportScale);
  const outH = even(p.canvas.height * p.exportScale);
  const length = keptLength(p.trim, p.cuts);
  const targetBytes = p.exportSizeMode === 'target' ? p.exportTargetMB * 1024 * 1024 : null;
  const bitrate = targetBytes ? bitrateForTargetSize(targetBytes, length, p.exportFps) : p.exportBitrateMbps * 1e6;
  const tooSmall = targetBytes !== null && bitrate <= MIN_BITRATE;
  const lowQuality = targetBytes !== null && bitrate / (outW * outH * p.exportFps) < LOW_BPP;

  const render = async () => {
    const video = getVideo(p.recording?.assetId);
    if (!video) return;
    setError(null);
    setResult(null);
    setSaveNote(null);
    setProgress(0);
    setPass(1);
    abortRef.current = new AbortController();
    const startedAt = performance.now();
    try {
      const renderAt = (rate: number) =>
        renderProject({
          project: useProject.getState(),
          video: video.blob,
          trim: p.trim,
          cuts: p.cuts,
          scale: p.exportScale,
          fps: p.exportFps,
          bitrate: rate,
          onProgress: setProgress,
          signal: abortRef.current!.signal,
        });
      let rate = bitrate;
      let r = await renderAt(rate);
      // Encoders only aim at a bitrate. If the file came out over the target, render again with the
      // bitrate scaled by how far off it was, and keep the smallest result.
      for (let retry = 1; targetBytes && r.blob.size > targetBytes && rate > MIN_BITRATE && retry <= MAX_RETRIES; retry++) {
        rate = Math.max(MIN_BITRATE, Math.round(rate * (targetBytes / r.blob.size) * 0.95));
        setPass(retry + 1);
        setProgress(0);
        const next = await renderAt(rate);
        if (next.blob.size < r.blob.size) r = next;
      }
      setResult({ ...r, url: URL.createObjectURL(r.blob), seconds: (performance.now() - startedAt) / 1000, targetBytes });
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
      <Segmented
        value={p.exportSizeMode}
        options={[
          { value: 'bitrate', label: 'Set bitrate' },
          { value: 'target', label: 'Set file size' },
        ]}
        onChange={(exportSizeMode) => p.set({ exportSizeMode })}
      />
      <div className="row">
        <Field label="Frame rate">
          <select value={p.exportFps} onChange={(e) => p.set({ exportFps: Number(e.target.value) })}>
            <option value={60}>60 fps</option>
            <option value={30}>30 fps</option>
          </select>
        </Field>
        {targetBytes === null ? (
          <Field label="Bitrate">
            <Num value={p.exportBitrateMbps} min={1} max={100} suffix="Mbps" onChange={(exportBitrateMbps) => p.set({ exportBitrateMbps })} />
          </Field>
        ) : (
          <Field label="Target size">
            <Num value={p.exportTargetMB} min={0.1} max={2000} step={0.1} suffix="MB" onChange={(exportTargetMB) => p.set({ exportTargetMB })} />
          </Field>
        )}
      </div>
      <p className="hint">
        {outW}×{outH}, {length.toFixed(2)}s,{' '}
        {targetBytes === null
          ? `about ${formatBytes((bitrate * length) / 8)}.`
          : `at most ${formatBytes(targetBytes)} (${bitrate >= 1e6 ? `${(bitrate / 1e6).toFixed(1)} Mbps` : `${Math.round(bitrate / 1000)} kbps`}).`}
      </p>
      {tooSmall ? (
        <Notice tone="warn">This target is too small for a {length.toFixed(1)}s video, so the file will come out larger. Raise the target or shorten the clip.</Notice>
      ) : (
        lowQuality && <Notice tone="warn">The picture will look blocky at this size. Raise the target, or lower the size or frame rate.</Notice>
      )}

      {progress === null ? (
        <button type="button" className="primary" disabled={!p.recording} onClick={render}>
          Render video
        </button>
      ) : (
        <div className="progress">
          <progress value={progress} max={1} aria-label="Render progress" />
          <span>
            {pass > 1 && `Pass ${pass}, shrinking to fit · `}
            {Math.round(progress * 100)}%
          </span>
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
          {result.targetBytes !== null && result.blob.size > result.targetBytes && (
            <Notice tone="warn">
              The file is {formatBytes(result.blob.size)}, over the {formatBytes(result.targetBytes)} target. The encoder cannot go lower at this size and frame rate; reduce one of them and render again.
            </Notice>
          )}
          <p className="hint">
            {result.width}×{result.height} · {result.frames} frames · {formatBytes(result.blob.size)} · rendered in {result.seconds.toFixed(1)}s
          </p>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              setSaveNote(null);
              const outcome = await saveFile(result.blob, fileName());
              if (outcome === 'unavailable') setSaveNote('Saving files is not available in this view. Open the page in a browser tab on claude.ai, or run the app locally.');
            }}
          >
            Download {result.extension.toUpperCase()}
          </button>
          {saveNote && <Notice tone="warn">{saveNote}</Notice>}
        </div>
      )}
    </Section>
  );
}
