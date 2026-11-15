import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/media';
import { videoUrl } from '../lib/player';

const THUMB_W = 160;

/**
 * YouTube-style thumbnail above the timeline. Uses its own <video> so hovering
 * never moves the main preview. Seeks are coalesced: while one is decoding,
 * only the latest requested time is kept.
 */
export function HoverPreview({ time, x, aspect }: { time: number; x: number; aspect: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pending = useRef<number | null>(null);

  if (!videoRef.current) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    videoRef.current = v;
  }

  useEffect(() => {
    const v = videoRef.current!;
    const url = videoUrl();
    if (url && v.src !== url) v.src = url;
    const draw = () => {
      const c = canvasRef.current;
      if (c && v.videoWidth) c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      if (pending.current !== null) {
        const t = pending.current;
        pending.current = null;
        v.currentTime = t;
      }
    };
    v.addEventListener('seeked', draw);
    return () => v.removeEventListener('seeked', draw);
  }, []);

  useEffect(() => {
    const v = videoRef.current!;
    if (v.seeking) pending.current = time;
    else v.currentTime = time;
  }, [time]);

  const h = Math.round(THUMB_W / (aspect || 16 / 9));
  return (
    <div className="hover-preview" style={{ left: x }}>
      <canvas ref={canvasRef} width={THUMB_W * 2} height={h * 2} style={{ width: THUMB_W, height: h }} />
      <span>{formatTime(time)}</span>
    </div>
  );
}
