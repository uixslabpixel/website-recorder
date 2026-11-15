/** A single off-DOM <video> feeds the editor preview; the timeline drives it. */
export const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.preload = 'auto';

let currentUrl: string | null = null;

export function loadVideo(url: string | null) {
  if (url === currentUrl) return;
  currentUrl = url;
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
  if (Number.isFinite(time)) video.currentTime = Math.max(0, time);
}

export function play(trim: { in: number; out: number }) {
  if (video.currentTime < trim.in || video.currentTime >= trim.out - 0.03) video.currentTime = trim.in;
  void video.play().catch(() => {});
}

export function pause() {
  video.pause();
}

/** Called every animation frame: loops playback inside the trim range and returns the playhead. */
export function tickPlayer(trim: { in: number; out: number }, playing: boolean) {
  if (playing && (video.currentTime >= trim.out || video.ended)) {
    video.currentTime = trim.in;
    if (video.paused) void video.play().catch(() => {});
  }
  return video.currentTime;
}

export function currentFrame() {
  if (!currentUrl || video.readyState < 2 || !video.videoWidth) return null;
  return { image: video, width: video.videoWidth, height: video.videoHeight };
}
