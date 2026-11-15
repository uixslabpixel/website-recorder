import { keptLength } from '../lib/edit';
import { useEffect, useRef, useState } from 'react';
import { getVideo } from '../lib/assets';
import { saveFile } from '../lib/env';
import { formatBytes } from '../lib/media';
import { MIN_BITRATE, bitrateForTargetSize, renderProject, type RenderResult } from '../lib/render';
import { useProject } from '../store';
import { Icon, Notice, Num, Row, Segmented, useDismiss } from './controls';

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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, open, () => setOpen(false));

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const length = keptLength(p.trim, p.cuts);
  const gif = p.exportFormat === 'gif';
  // A target size only applies to video; a GIF has no bitrate to steer.
  const targetBytes = !gif && p.exportSizeMode === 'target' ? p.exportTargetMB * 1024 * 1024 : null;
  const bitrate = targetBytes ? bitrateForTargetSize(targetBytes, length, p.exportFps) : p.exportBitrateMbps * 1e6;
  const pixelRate = even(p.canvas.width * p.exportScale) * even(p.canvas.height * p.exportScale) * p.exportFps;
  const tooSmall = targetBytes !== null && bitrate <= MIN_BITRATE;
  const lowQuality = targetBytes !== null && bitrate / pixelRate < LOW_BPP;

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
          format: p.exportFormat,
          scale: gif ? p.gifScale : p.exportScale,
          fps: gif ? p.gifFps : p.exportFps,
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
      setOpen(true);
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

  const busy = progress !== null;
  return (
    <div className="menu" ref={menuRef}>
      <button type="button" className="accent" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {busy ? `${Math.round(progress * 100)}%` : 'Export'}
      </button>
      {open && (
        <div className="popover export" role="dialog" aria-label="Export">
          <Segmented
            value={p.exportFormat}
            options={[
              { value: 'video', label: 'MP4' },
              { value: 'gif', label: 'GIF' },
            ]}
            onChange={(exportFormat) => p.set({ exportFormat })}
          />
          <Row label="Size">
            <select value={gif ? p.gifScale : p.exportScale} onChange={(e) => p.set(gif ? { gifScale: Number(e.target.value) } : { exportScale: Number(e.target.value) })}>
              {[1, 0.75, 0.5, 0.25].map((s) => (
                <option key={s} value={s}>
                  {even(p.canvas.width * s)}×{even(p.canvas.height * s)}
                  {s === 1 ? '' : ` (${s * 100}%)`}
                </option>
              ))}
            </select>
          </Row>
          {gif ? (
            <Row label="Frame rate" tip="GIFs are limited to 256 colours and grow fast. Smaller size and fewer frames keep the file light.">
              <select value={p.gifFps} onChange={(e) => p.set({ gifFps: Number(e.target.value) })}>
                {[25, 20, 12.5, 10].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </Row>
          ) : (
            <>
              <Row label="Frame rate">
                <select value={p.exportFps} onChange={(e) => p.set({ exportFps: Number(e.target.value) })}>
                  <option value={60}>60 fps</option>
                  <option value={30}>30 fps</option>
                </select>
              </Row>
              <Row label="Set by" tip="Bitrate fixes the quality. File size fits the video under a size you choose.">
                <Segmented
                  value={p.exportSizeMode}
                  options={[
                    { value: 'bitrate', label: 'Bitrate' },
                    { value: 'target', label: 'File size' },
                  ]}
                  onChange={(exportSizeMode) => p.set({ exportSizeMode })}
                />
              </Row>
              {targetBytes === null ? (
                <Row label="Bitrate" tip="Higher is sharper, and a bigger file.">
                  <Num value={p.exportBitrateMbps} min={1} max={100} suffix="Mbps" onChange={(exportBitrateMbps) => p.set({ exportBitrateMbps })} />
                </Row>
              ) : (
                <Row label="Max size" tip="The bitrate is worked out from the clip length. If the file comes out larger, it is rendered again.">
                  <Num value={p.exportTargetMB} min={0.1} max={2000} step={0.1} suffix="MB" onChange={(exportTargetMB) => p.set({ exportTargetMB })} />
                </Row>
              )}
              {p.recording && tooSmall && <Notice tone="warn">Too small for {length.toFixed(1)}s. Raise the size or shorten the clip.</Notice>}
              {p.recording && !tooSmall && lowQuality && <Notice tone="warn">Will look blocky. Raise the size, or lower the resolution or frame rate.</Notice>}
            </>
          )}

          {busy ? (
            <div className="progress">
              <progress value={progress} max={1} aria-label="Render progress" />
              {pass > 1 && <span className="meta">Pass {pass}</span>}
              <button type="button" className="small" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="primary wide" disabled={!p.recording} onClick={render}>
              {result ? 'Render again' : 'Render'}
              {p.recording && (
                <span className="meta">
                  {length.toFixed(1)}s{gif ? '' : targetBytes ? ` · ≤${formatBytes(targetBytes)}` : ` · ~${formatBytes((bitrate * length) / 8)}`}
                </span>
              )}
            </button>
          )}
          {!p.recording && <p className="hint">No recording yet</p>}
          {error && <Notice tone="error">{error}</Notice>}
          {result && !busy && (
            <div className="result">
              {result.extension === 'gif' ? <img src={result.url} alt="Rendered GIF" /> : <video src={result.url} controls loop muted playsInline />}
              {result.targetBytes !== null && result.blob.size > result.targetBytes && (
                <Notice tone="warn">Over the {formatBytes(result.targetBytes)} limit. Lower the resolution or frame rate and render again.</Notice>
              )}
              {result.extension === 'webm' && <Notice tone="warn">No H.264 encoder in this browser, so this is WebM.</Notice>}
              <button
                type="button"
                className="accent wide"
                data-tip={`${result.width}×${result.height} · ${result.frames} frames · rendered in ${result.seconds.toFixed(1)}s`}
                onClick={async () => {
                  setSaveNote(null);
                  const outcome = await saveFile(result.blob, fileName());
                  if (outcome === 'unavailable') setSaveNote('Saving is blocked in this view. Open the page in its own tab, or run the app locally.');
                }}
              >
                <Icon name="download" />
                Download {result.extension.toUpperCase()}
                <span className="meta">{formatBytes(result.blob.size)}</span>
              </button>
              {saveNote && <Notice tone="warn">{saveNote}</Notice>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
