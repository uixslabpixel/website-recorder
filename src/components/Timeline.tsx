import { useEffect, useRef, useState } from 'react';
import { keptLength } from '../lib/edit';
import { formatTime } from '../lib/media';
import { HoverPreview } from './HoverPreview';
import { pause, play, seek } from '../lib/player';
import { useProject, useUi } from '../store';

type Handle = 'in' | 'out' | 'playhead' | { cut: number; edge: 'start' | 'end' };

/** Length a new cut gets when added at the playhead. */
const NEW_CUT = 1;

export function Timeline() {
  const recording = useProject((s) => s.recording);
  const trim = useProject((s) => s.trim);
  const cuts = useProject((s) => s.cuts);
  const { setTrim, addCut, updateCut, removeCut } = useProject.getState();
  const { playing, time, setPlaying } = useUi();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Handle | null>(null);
  const [selectedCut, setSelectedCut] = useState<number | null>(null);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
  const duration = recording?.duration ?? 0;

  const toggle = () => {
    if (!recording) return;
    if (playing) pause();
    else {
      const s = useProject.getState();
      play(s.trim, s.cuts);
    }
    setPlaying(!playing);
  };

  // Jump to the trim start (skipping a cut that begins there) and play.
  const playFromStart = () => {
    if (!recording) return;
    const s = useProject.getState();
    seek(s.trim.in);
    play(s.trim, s.cuts);
    setPlaying(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.code === 'Space' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        toggle();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCut !== null) {
        e.preventDefault();
        removeCut(selectedCut);
        setSelectedCut(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!recording) return <div className="timeline empty">Trim controls appear once there is a recording.</div>;

  const timeAt = (clientX: number) => {
    const box = trackRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * duration;
  };

  const apply = (handle: Handle, t: number) => {
    if (handle === 'in') setTrim({ in: t });
    else if (handle === 'out') setTrim({ out: t });
    else if (typeof handle === 'object') updateCut(handle.cut, { [handle.edge]: t });
    // Show the frame under whatever is being dragged.
    const s = useProject.getState();
    if (handle === 'in') seek(s.trim.in);
    else if (handle === 'out') seek(s.trim.out);
    else if (typeof handle === 'object') seek(s.cuts[handle.cut]?.[handle.edge] ?? t);
    else seek(t);
  };

  const start = (handle: Handle) => (e: React.PointerEvent) => {
    // Stops the browser from starting a text selection or a native drag on a missed grab.
    e.preventDefault();
    e.stopPropagation();
    if (playing) {
      pause();
      setPlaying(false);
    }
    if (typeof handle === 'object') setSelectedCut(handle.cut);
    else if (handle === 'playhead') setSelectedCut(null);
    dragging.current = handle;
    trackRef.current!.setPointerCapture(e.pointerId);
    apply(handle, timeAt(e.clientX));
  };

  const nudge = (handle: Handle, value: number) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 1 / 30;
    if (e.key === 'ArrowLeft') apply(handle, value - step);
    else if (e.key === 'ArrowRight') apply(handle, value + step);
    else return;
    e.preventDefault();
  };

  // Inside a cut: remove it. Otherwise cut NEW_CUT seconds starting at the playhead.
  const cutAtPlayhead = () => {
    const inside = cuts.findIndex((c) => time >= c.start && time <= c.end);
    if (inside >= 0) {
      removeCut(inside);
      setSelectedCut(null);
      return;
    }
    const a = Math.min(Math.max(time, trim.in), Math.max(trim.in, trim.out - NEW_CUT));
    setSelectedCut(addCut(a, Math.min(a + NEW_CUT, trim.out)));
  };
  const insideCut = cuts.some((c) => time >= c.start && time <= c.end);

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const slider = (label: string, value: number) => ({
    role: 'slider',
    tabIndex: 0,
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': duration,
    'aria-valuenow': value,
    'aria-valuetext': formatTime(value),
  });

  return (
    <div className="timeline">
      <button type="button" className="play restart" onClick={playFromStart} aria-label="Play from the beginning" title="Play from the beginning">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="2" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
          <path d="M14 3.5v9a.5.5 0 0 1-.77.42L6.3 8.42a.5.5 0 0 1 0-.84l6.93-4.5A.5.5 0 0 1 14 3.5Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="time">{formatTime(time)}</span>
      <button type="button" className="cut-btn" onClick={cutAtPlayhead} title={insideCut ? 'Remove the cut under the playhead' : `Cut ${NEW_CUT}s from the playhead; drag its edges to adjust`}>
        {insideCut ? 'Uncut' : '✂ Cut'}
      </button>
      <div
        className="track"
        ref={trackRef}
        onPointerDown={start('playhead')}
        onPointerMove={(e) => {
          if (dragging.current) {
            apply(dragging.current, timeAt(e.clientX));
            setHover(null);
            return;
          }
          // Clamp so the thumbnail never pokes out past the track's ends.
          const box = trackRef.current!.getBoundingClientRect();
          const x = Math.min(Math.max(e.clientX - box.left, 80), box.width - 80);
          setHover({ t: timeAt(e.clientX), x });
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        onDragStart={(e) => e.preventDefault()}
      >
        {hover && <HoverPreview time={hover.t} x={hover.x} aspect={recording.width / recording.height} />}
        <div className="range" style={{ left: pct(trim.in), width: pct(trim.out - trim.in) }} />
        {cuts.map((c, i) => (
          <div key={i} className={`cut${selectedCut === i ? ' selected' : ''}`} style={{ left: pct(c.start), width: pct(c.end - c.start) }}>
            <div className="cut-edge start" {...slider(`Cut ${i + 1} start`, c.start)} onPointerDown={start({ cut: i, edge: 'start' })} onKeyDown={nudge({ cut: i, edge: 'start' }, c.start)} />
            <div className="cut-edge end" {...slider(`Cut ${i + 1} end`, c.end)} onPointerDown={start({ cut: i, edge: 'end' })} onKeyDown={nudge({ cut: i, edge: 'end' }, c.end)} />
            <button
              type="button"
              className="cut-remove"
              aria-label={`Remove cut ${formatTime(c.start)}–${formatTime(c.end)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                removeCut(i);
                setSelectedCut(null);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="handle in" style={{ left: pct(trim.in) }} {...slider('Trim start', trim.in)} onPointerDown={start('in')} onKeyDown={nudge('in', trim.in)} />
        <div className="handle out" style={{ left: pct(trim.out) }} {...slider('Trim end', trim.out)} onPointerDown={start('out')} onKeyDown={nudge('out', trim.out)} />
        <div
          className="playhead"
          style={{ left: pct(Math.min(time, duration)) }}
          {...slider('Playhead', time)}
          onPointerDown={start('playhead')}
          onKeyDown={nudge('playhead', time)}
        />
      </div>
      <span className="time" title="Edited length / full recording">
        {formatTime(keptLength(trim, cuts))} <small>of {formatTime(duration)}</small>
      </span>
    </div>
  );
}
