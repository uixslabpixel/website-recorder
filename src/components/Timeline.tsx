import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/media';
import { pause, play, seek } from '../lib/player';
import { useProject, useUi } from '../store';

type Handle = 'in' | 'out' | 'playhead';

export function Timeline() {
  const recording = useProject((s) => s.recording);
  const trim = useProject((s) => s.trim);
  const setTrim = useProject((s) => s.setTrim);
  const { playing, time, setPlaying } = useUi();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<Handle | null>(null);
  const duration = recording?.duration ?? 0;

  const toggle = () => {
    if (!recording) return;
    if (playing) pause();
    else play(useProject.getState().trim);
    setPlaying(!playing);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
      e.preventDefault();
      toggle();
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
    // Show the frame under whatever is being dragged.
    const now = useProject.getState().trim;
    seek(handle === 'in' ? now.in : handle === 'out' ? now.out : t);
  };

  const start = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (playing) {
      pause();
      setPlaying(false);
    }
    dragging.current = handle;
    trackRef.current!.setPointerCapture(e.pointerId);
    apply(handle, timeAt(e.clientX));
  };

  const nudge = (handle: 'in' | 'out') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.5 : 1 / 30;
    if (e.key === 'ArrowLeft') apply(handle, trim[handle] - step);
    else if (e.key === 'ArrowRight') apply(handle, trim[handle] + step);
    else return;
    e.preventDefault();
  };

  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <div className="timeline">
      <button type="button" className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="time">{formatTime(time)}</span>
      <div
        className="track"
        ref={trackRef}
        onPointerDown={start('playhead')}
        onPointerMove={(e) => dragging.current && apply(dragging.current, timeAt(e.clientX))}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <div className="range" style={{ left: pct(trim.in), width: pct(trim.out - trim.in) }} />
        <div
          className="handle in"
          style={{ left: pct(trim.in) }}
          role="slider"
          tabIndex={0}
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={trim.in}
          aria-valuetext={formatTime(trim.in)}
          onPointerDown={start('in')}
          onKeyDown={nudge('in')}
        />
        <div
          className="handle out"
          style={{ left: pct(trim.out) }}
          role="slider"
          tabIndex={0}
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={trim.out}
          aria-valuetext={formatTime(trim.out)}
          onPointerDown={start('out')}
          onKeyDown={nudge('out')}
        />
        <div className="playhead" style={{ left: pct(Math.min(time, duration)) }} />
      </div>
      <span className="time" title="Trimmed length / full recording">
        {formatTime(trim.out - trim.in)} <small>of {formatTime(duration)}</small>
      </span>
    </div>
  );
}
