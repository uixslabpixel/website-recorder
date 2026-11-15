# Website Recorder

Record an interaction on any website, frame it on a background, and export a Dribbble-ready video. Everything runs in the browser: no login, no backend, no uploads. See [PLAN.md](PLAN.md) for the design.

## Run

```bash
npm install
npm run dev
```

`npm run build` produces a static site in `dist/` that can be hosted anywhere. Use Chrome or Edge on desktop.

`npm run build:hosted` builds a single self-contained HTML file (`artifact/website-recorder.html`) for hosts that only take one page. That build has no recording (screen capture is not allowed there): it opens with a sample clip and works on imported videos.

## How it works

1. **Setup** – enter a URL, viewport (default 1680×900) and duration (default 5s).
2. **Record** – one click. A small window opens and the browser asks what to share; pick the tab named *Website Recorder: pick this tab*.
3. **Interact** – that window grows to the viewport, counts down 3-2-1, then loads the website and records for the set duration before closing itself.
4. **Edit** – canvas size (Dribbble 4:3 by default), solid/gradient/image background, recording scale/position/radius/shadow, extra image layers with ordering. Drag layers on the canvas.
5. **Trim** – drag the timeline handles; only in/out points are stored.
6. **Export** – frames are composited and encoded with WebCodecs to H.264 MP4 at 60fps. Size can be reduced (75/50/25%), and the MP4 is sized either by bitrate or by a maximum file size in MB: the bitrate is worked out from the clip length, and the export is rendered again at a lower bitrate if it comes out over. The same menu exports an animated GIF (half size and 20fps by default, since GIFs are limited to 256 colours and grow fast).

An existing video file can be imported instead of recording. The project (settings, recording, images) is saved locally in the browser and survives a refresh.

## Code map

| Path | Role |
|---|---|
| `src/lib/capture.ts` | Popup, `getDisplayMedia`, `MediaRecorder`, capture warnings |
| `src/lib/media.ts` | Remux the raw recording into a seekable file, read duration/size |
| `src/lib/compositor.ts` | Draws one frame; shared by the preview and the export |
| `src/lib/render.ts` | Decode → composite → encode → mux (Mediabunny + WebCodecs), and GIF encoding (gifenc) |
| `src/lib/assets.ts` | Recording and image blobs in IndexedDB |
| `src/store.ts` | Project state (Zustand, persisted to localStorage) |

## Known limits

- The browser's tab picker appears for every recording and cannot be skipped.
- The popup cannot be larger than the screen; the app warns and offers "Fit".
- **Hide cursor** is a request the browser may ignore. In testing, Chromium did not honor it for tab capture; the app warns when that happens.
- Deferred (P3 in the plan): custom cursor and click visualisation. They need a companion browser extension, which is not wanted for now.
