import { skipCut, type Range } from './edit';
/** A single off-DOM <video> feeds the editor preview; the timeline drives it. */
export const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.preload = 'auto';

let currentUrl: string | null = null;

// Last good frame, shown while a seek (scrubbing, looping, jumping over a cut) decodes the next one.
// Without it the preview flashes black for a frame or two.
const held = document.createElement('canvas');
const heldCtx = held.getContext('2d')!;
let hasHeld = false;

function setTime(t: number) {
  if (video.readyState >= 2 && video.videoWidth && !video.seeking) {
    if (held.width !== video.videoWidth || held.height !== video.videoHeight) {
      held.width = video.videoWidth;
      held.height = video.videoHeight;
    }
    heldCtx.drawImage(video, 0, 0);
    hasHeld = true;
  }
  video.currentTime = t;
}

export function loadVideo(url: string | null) {
  if (url === currentUrl) return;
  currentUrl = url;
  hasHeld = false;
  video.pause();
  if (url) {
    video.src = url;
    video.load();
  } else {
    video.removeAttribute('src');
    video.load();
  }
}

export function seek(time: number) {
  if (Number.isFinite(time)) setTime(Math.max(0, time));
}

export function play(trim: { in: number; out: number }, cuts: Range[] = []) {
  if (video.currentTime < trim.in || video.currentTime >= trim.out - 0.03) setTime(trim.in);
  const jump = skipCut(video.currentTime, cuts);
  if (jump !== null) setTime(jump);
  void video.play().catch(() => {});
}

export function pause() {
  video.pause();
}

/** Called every animation frame: loops playback inside the trim, skips cuts, returns the playhead. */
export function tickPlayer(trim: { in: number; out: number }, cuts: Range[], playing: boolean) {
  if (playing) {
    const jump = skipCut(video.currentTime, cuts);
    if (video.currentTime >= trim.out || video.ended || (jump !== null && jump >= trim.out)) {
      setTime(trim.in);
      const first = skipCut(trim.in, cuts);
      if (first !== null) setTime(first);
      if (video.paused) void video.play().catch(() => {});
    } else if (jump !== null) {
      setTime(jump);
    }
  }
  return video.currentTime;
}

export function currentFrame() {
  if (!currentUrl) return null;
  if (video.seeking || video.readyState < 2 || !video.videoWidth) {
    return hasHeld ? { image: held, width: held.width, height: held.height } : null;
  }
  return { image: video, width: video.videoWidth, height: video.videoHeight };
}

/** Object URL of the loaded recording, for secondary readers like the hover thumbnail. */
export function videoUrl() {
  return currentUrl;
}
