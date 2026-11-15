import { keptLength } from '../lib/edit';
import { useEffect, useRef, useState } from 'react';
import { getVideo } from '../lib/assets';
import { saveFile } from '../lib/env';
import { formatBytes } from '../lib/media';
import { renderProject, type RenderResult } from '../lib/render';
import { useProject } from '../store';
import { Icon, Notice, Num, Row, Segmented, useDismiss } from './controls';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ExportPanel() {
  const p = useProject();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(RenderResult & { url: string; seconds: number }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, open, () => setOpen(false));

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const length = keptLength(p.trim, p.cuts);
  const gif = p.exportFormat === 'gif';

  const render = async () => {
    const video = getVideo(p.recording?.assetId);
    if (!video) return;
    setError(null);
    setResult(null);
    setSaveNote(null);
    setProgress(0);
    abortRef.current = new AbortController();
    const startedAt = performance.now();
    try {
      const r = await renderProject({
        project: useProject.getState(),
        video: video.blob,
        trim: p.trim,
        cuts: p.cuts,
        format: p.exportFormat,
        scale: gif ? p.gifScale : p.exportScale,
        fps: gif ? p.gifFps : p.exportFps,
        bitrate: p.exportBitrateMbps * 1e6,
        onProgress: setProgress,
        signal: abortRef.current.signal,
      });
      setResult({ ...r, url: URL.createObjectURL(r.blob), seconds: (performance.now() - startedAt) / 1000 });
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
              <Row label="Bitrate" tip="Higher is sharper, and a bigger file.">
                <Num value={p.exportBitrateMbps} min={1} max={100} suffix="Mbps" onChange={(exportBitrateMbps) => p.set({ exportBitrateMbps })} />
              </Row>
            </>
          )}

          {busy ? (
            <div className="progress">
              <progress value={progress} max={1} aria-label="Render progress" />
              <button type="button" className="small" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="primary wide" disabled={!p.recording} onClick={render}>
              {result ? 'Render again' : 'Render'}
              {p.recording && (
                <span className="meta">
                  {length.toFixed(1)}s{gif ? '' : ` · ~${formatBytes((p.exportBitrateMbps * 1e6 * length) / 8)}`}
                </span>
              )}
            </button>
          )}
          {!p.recording && <p className="hint">No recording yet</p>}
          {error && <Notice tone="error">{error}</Notice>}
          {result && !busy && (
            <div className="result">
              {result.extension === 'gif' ? <img src={result.url} alt="Rendered GIF" /> : <video src={result.url} controls loop muted playsInline />}
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
