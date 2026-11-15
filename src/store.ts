import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const RECORDING_LAYER_ID = 'recording';

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'image'; assetId: string | null };

/** Position is the layer centre as an offset from the canvas centre, in canvas-width/height fractions. */
export interface Transform {
  x: number;
  y: number;
  /** Layer width as a fraction of the canvas width. */
  scale: number;
}

export interface RecordingLayer extends Transform {
  /** Corner radius in canvas pixels. */
  radius: number;
  shadow: boolean;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
}

export interface ImageLayer extends Transform {
  id: string;
  assetId: string;
  name: string;
  radius: number;
}

export interface Recording {
  assetId: string;
  duration: number;
  width: number;
  height: number;
  /** What the browser reported for the capture, kept to explain warnings. */
  /** Bundled demo clip rather than the user's own recording. */
  sample?: boolean;
  displaySurface?: string;
  cursor?: string;
}

export interface Project {
  url: string;
  viewport: { width: number; height: number };
  recordSeconds: number;
  hideCursor: boolean;

  canvas: { width: number; height: number };
  background: Background;
  recordingLayer: RecordingLayer;
  imageLayers: ImageLayer[];
  /** Bottom-to-top draw order; contains RECORDING_LAYER_ID and image layer ids. */
  order: string[];

  recording: Recording | null;
  trim: { in: number; out: number };
  /** Ranges removed from the middle of the trim, in recording seconds, sorted, non-overlapping. */
  cuts: { start: number; end: number }[];

  exportScale: number;
  exportFps: number;
  exportBitrateMbps: number;
  /** MP4 only: 'bitrate' uses exportBitrateMbps, 'target' derives the bitrate from exportTargetMB. */
  exportSizeMode: 'bitrate' | 'target';
  exportTargetMB: number;
  exportFormat: 'video' | 'gif';
  /** GIFs get their own size and frame rate: full-size 60fps would be enormous. */
  gifScale: number;
  gifFps: number;
}

export const CANVAS_PRESETS = [
  { label: 'Dribbble 4:3', width: 1600, height: 1200 },
  { label: 'Dribbble 4:3 (HD)', width: 2800, height: 2100 },
  { label: 'Landscape 16:9', width: 1920, height: 1080 },
  { label: 'Square 1:1', width: 1200, height: 1200 },
  { label: 'Portrait 4:5', width: 1080, height: 1350 },
];

export const VIEWPORT_PRESETS = [
  { label: 'Desktop 1680×900', width: 1680, height: 900 },
  { label: 'Laptop 1440×900', width: 1440, height: 900 },
  { label: 'Laptop 1280×720', width: 1280, height: 720 },
  { label: 'Tablet 834×1112', width: 834, height: 1112 },
  { label: 'Mobile 390×844', width: 390, height: 844 },
];

const defaults: Project = {
  url: '',
  viewport: { width: 1680, height: 900 },
  recordSeconds: 5,
  hideCursor: false,
  canvas: { width: 1600, height: 1200 },
  background: { type: 'gradient', from: '#6d5efc', to: '#f472b6', angle: 135 },
  recordingLayer: {
    x: 0,
    y: 0,
    scale: 0.82,
    radius: 16,
    shadow: true,
    shadowBlur: 60,
    shadowOffsetY: 24,
    shadowOpacity: 0.35,
  },
  imageLayers: [],
  order: [RECORDING_LAYER_ID],
  recording: null,
  trim: { in: 0, out: 0 },
  cuts: [],
  exportScale: 1,
  exportFps: 60,
  exportBitrateMbps: 20,
  exportSizeMode: 'bitrate',
  exportTargetMB: 8,
  exportFormat: 'video',
  gifScale: 0.5,
  gifFps: 20,
};

export const MIN_TRIM = 0.1;

interface Actions {
  set: (patch: Partial<Project>) => void;
  setRecordingLayer: (patch: Partial<RecordingLayer>) => void;
  setRecording: (recording: Recording | null) => void;
  setTrim: (patch: Partial<Project['trim']>) => void;
  /** Adds a cut, merging it with any it overlaps; returns its index. */
  addCut: (start: number, end: number) => number;
  updateCut: (index: number, patch: Partial<{ start: number; end: number }>) => void;
  removeCut: (index: number) => void;
  addImageLayer: (assetId: string, name: string) => string;
  updateImageLayer: (id: string, patch: Partial<ImageLayer>) => void;
  removeImageLayer: (id: string) => void;
  moveLayer: (id: string, direction: 1 | -1) => void;
  resetProject: () => void;
}

export const useProject = create<Project & Actions>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      setRecordingLayer: (patch) => set((s) => ({ recordingLayer: { ...s.recordingLayer, ...patch } })),
      setRecording: (recording) =>
        set({ recording, cuts: [], trim: { in: 0, out: recording ? recording.duration : 0 } }),
      setTrim: (patch) =>
        set((s) => {
          const duration = s.recording?.duration ?? 0;
          let { in: a, out: b } = { ...s.trim, ...patch };
          a = Math.min(Math.max(0, a), Math.max(0, duration - MIN_TRIM));
          b = Math.min(Math.max(b, 0), duration);
          // Keep the handle being dragged from crossing the other one.
          if (b - a < MIN_TRIM) {
            if (patch.in !== undefined) a = Math.max(0, b - MIN_TRIM);
            else b = Math.min(duration, a + MIN_TRIM);
          }
          return { trim: { in: a, out: b } };
        }),
      addCut: (start, end) => {
        let index = 0;
        set((s) => {
          const duration = s.recording?.duration ?? 0;
          let a = Math.max(0, Math.min(start, end));
          let b = Math.min(duration, Math.max(start, end));
          if (b - a < MIN_TRIM) b = Math.min(duration, a + MIN_TRIM);
          const rest: { start: number; end: number }[] = [];
          for (const c of s.cuts) {
            if (c.end < a || c.start > b) rest.push(c);
            else {
              a = Math.min(a, c.start);
              b = Math.max(b, c.end);
            }
          }
          const cuts = [...rest, { start: a, end: b }].sort((x, y) => x.start - y.start);
          index = cuts.findIndex((c) => c.start === a);
          return { cuts };
        });
        return index;
      },
      updateCut: (index, patch) =>
        set((s) => {
          const c = s.cuts[index];
          if (!c) return {};
          const duration = s.recording?.duration ?? 0;
          // Neighbours bound the cut, so cuts never overlap or swap order.
          const lo = s.cuts[index - 1]?.end ?? 0;
          const hi = s.cuts[index + 1]?.start ?? duration;
          let a = patch.start ?? c.start;
          let b = patch.end ?? c.end;
          a = Math.min(Math.max(lo, a), hi - MIN_TRIM);
          b = Math.max(Math.min(hi, b), lo + MIN_TRIM);
          if (b - a < MIN_TRIM) {
            if (patch.start !== undefined) a = b - MIN_TRIM;
            else b = a + MIN_TRIM;
          }
          const cuts = [...s.cuts];
          cuts[index] = { start: a, end: b };
          return { cuts };
        }),
      removeCut: (index) => set((s) => ({ cuts: s.cuts.filter((_, i) => i !== index) })),
      addImageLayer: (assetId, name) => {
        const id = `img-${crypto.randomUUID()}`;
        set((s) => ({
          imageLayers: [...s.imageLayers, { id, assetId, name, x: 0, y: 0, scale: 0.3, radius: 0 }],
          order: [...s.order, id],
        }));
        return id;
      },
      updateImageLayer: (id, patch) =>
        set((s) => ({ imageLayers: s.imageLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      removeImageLayer: (id) =>
        set((s) => ({
          imageLayers: s.imageLayers.filter((l) => l.id !== id),
          order: s.order.filter((o) => o !== id),
        })),
      moveLayer: (id, direction) =>
        set((s) => {
          const i = s.order.indexOf(id);
          const j = i + direction;
          if (i < 0 || j < 0 || j >= s.order.length) return s;
          const order = [...s.order];
          [order[i], order[j]] = [order[j], order[i]];
          return { order };
        }),
      resetProject: () => set({ ...defaults }),
    }),
    {
      name: 'website-recorder-project',
      version: 1,
      partialize: (s) => {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') data[k] = v;
        return data as unknown as Project & Actions;
      },
    },
  ),
);

/** Every asset id the project references, used to prune orphaned blobs. */
export function referencedAssets(p: Project): Set<string> {
  const ids = new Set<string>();
  if (p.recording) ids.add(p.recording.assetId);
  if (p.background.type === 'image' && p.background.assetId) ids.add(p.background.assetId);
  p.imageLayers.forEach((l) => ids.add(l.assetId));
  return ids;
}

/** Transient UI state that should not survive a refresh. */
interface UiState {
  selected: string | null;
  playing: boolean;
  /** Playhead in seconds on the source recording. */
  time: number;
  select: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
}

export const useUi = create<UiState>((set) => ({
  selected: RECORDING_LAYER_ID,
  playing: false,
  time: 0,
  select: (selected) => set({ selected }),
  setPlaying: (playing) => set({ playing }),
  setTime: (time) => set({ time }),
}));
