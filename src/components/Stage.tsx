import { useEffect, useRef } from 'react';
import { drawComposition, rectForLayer } from '../lib/compositor';
import { currentFrame, tickPlayer } from '../lib/player';
import { RECORDING_LAYER_ID, useProject, useUi } from '../store';

const SNAP = 0.012;

export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasSize = useProject((s) => s.canvas);
  const hasRecording = useProject((s) => !!s.recording);
  const isSample = useProject((s) => !!s.recording?.sample);

  // Fit the canvas inside the available area while keeping the project aspect ratio.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const layout = () => {
      const pad = 32;
      const k = Math.min((wrap.clientWidth - pad) / canvasSize.width, (wrap.clientHeight - pad) / canvasSize.height);
      const w = Math.max(50, Math.floor(canvasSize.width * k));
      const h = Math.max(50, Math.floor(canvasSize.height * k));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [canvasSize.width, canvasSize.height]);

  // Redraw every frame straight from the stores, so playback never re-renders React.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = useProject.getState();
      const ui = useUi.getState();
      if (p.recording) {
        const t = tickPlayer(p.trim, p.cuts, ui.playing);
        if (Math.abs(t - ui.time) > 0.001) ui.setTime(t);
      }
      const frame = currentFrame();
      drawComposition(ctx, p, frame, canvas.width, canvas.height);

      const rect = ui.selected ? rectForLayer(ui.selected, p, frame ?? undefined) : null;
      if (rect) {
        const k = canvas.width / p.canvas.width;
        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#008cff';
        ctx.strokeRect(rect.x * k, rect.y * k, rect.w * k, rect.h * k);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  const toCanvas = (e: React.PointerEvent) => {
    const box = canvasRef.current!.getBoundingClientRect();
    const p = useProject.getState();
    return {
      x: ((e.clientX - box.left) / box.width) * p.canvas.width,
      y: ((e.clientY - box.top) / box.height) * p.canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = useProject.getState();
    const pt = toCanvas(e);
    const hit = [...p.order].reverse().find((id) => {
      const r = rectForLayer(id, p, currentFrame() ?? undefined);
      return r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
    });
    useUi.getState().select(hit ?? null);
    if (!hit) return;
    const t = hit === RECORDING_LAYER_ID ? p.recordingLayer : p.imageLayers.find((l) => l.id === hit)!;
    drag.current = { id: hit, startX: pt.x, startY: pt.y, x: t.x, y: t.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = useProject.getState();
    const pt = toCanvas(e);
    let x = d.x + (pt.x - d.startX) / p.canvas.width;
    let y = d.y + (pt.y - d.startY) / p.canvas.height;
    // Snap to the canvas centre unless Alt is held.
    if (!e.altKey) {
      if (Math.abs(x) < SNAP) x = 0;
      if (Math.abs(y) < SNAP) y = 0;
    }
    if (d.id === RECORDING_LAYER_ID) p.setRecordingLayer({ x, y });
    else p.updateImageLayer(d.id, { x, y });
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        aria-label="Composition preview. Drag a layer to move it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      {isSample && (
        <p className="stage-hint" data-tip="Demo footage. Importing a video replaces it.">
          Sample clip
        </p>
      )}
      {!hasRecording && <p className="stage-hint">No recording yet</p>}
    </div>
  );
}
