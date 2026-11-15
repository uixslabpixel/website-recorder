import { useEffect, useState, useSyncExternalStore } from 'react';
import { ExportPanel } from './components/ExportPanel';
import { Inspector } from './components/Inspector';
import { RecordPanel } from './components/RecordPanel';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { getAssetsVersion, getVideo, loadAsset, pruneAssets, putAsset, subscribeAssets } from './lib/assets';
import { HOSTED, sampleVideo } from './lib/env';
import { prepareVideo } from './lib/media';
import { loadVideo, pause } from './lib/player';
import { referencedAssets, useProject, useUi } from './store';

/** Loads the blobs the saved project points at and drops references to anything that is gone. */
async function restoreProject() {
  const p = useProject.getState();
  if (p.recording && !(await loadAsset(p.recording.assetId))) p.setRecording(null);
  if (p.background.type === 'image' && p.background.assetId && !(await loadAsset(p.background.assetId))) {
    p.set({ background: { type: 'image', assetId: null } });
  }
  for (const layer of p.imageLayers) {
    if (!(await loadAsset(layer.assetId))) p.removeImageLayer(layer.id);
  }
  await pruneAssets(referencedAssets(useProject.getState()));
  await loadSample();
}

let sampleLoading: Promise<void> | null = null;

/** The hosted page cannot record, so it opens with a bundled demo clip instead of an empty canvas. */
function loadSample() {
  const blob = HOSTED && !useProject.getState().recording ? sampleVideo() : null;
  if (!blob) return Promise.resolve();
  sampleLoading ??= (async () => {
    try {
      const v = await prepareVideo(blob);
      const assetId = await putAsset(v.blob, 'video');
      useProject.getState().setRecording({ assetId, duration: v.duration, width: v.width, height: v.height, sample: true });
    } catch (err) {
      console.warn('Could not load the sample clip', err);
    } finally {
      sampleLoading = null;
    }
  })();
  return sampleLoading;
}

export function App() {
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useSyncExternalStore(subscribeAssets, getAssetsVersion);
  const recordingId = useProject((s) => s.recording?.assetId);
  const resetProject = useProject((s) => s.resetProject);

  useEffect(() => {
    void restoreProject().finally(() => setReady(true));
  }, []);

  // Point the preview player at the current recording.
  const videoUrl = getVideo(recordingId)?.url ?? null;
  useEffect(() => {
    useUi.getState().setPlaying(false);
    useUi.getState().setTime(0);
    loadVideo(videoUrl);
  }, [videoUrl]);

  const newProject = () => {
    setConfirming(false);
    pause();
    resetProject();
    useUi.getState().select('recording');
    void pruneAssets(new Set()).then(loadSample);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo" aria-hidden>
            ●
          </span>
          Website Recorder
        </h1>
        <span className="tagline">Record a site, frame it, export a Dribbble-ready video</span>
        {confirming ? (
          <span className="confirm" role="alertdialog" aria-label="Start a new project?">
            <span>Remove the recording, images and settings?</span>
            <button type="button" className="danger" onClick={newProject}>
              Remove
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            New project
          </button>
        )}
      </header>
      <aside className="panel left">
        <RecordPanel />
      </aside>
      <main className="center">
        {ready ? <Stage /> : <div className="stage" />}
        <Timeline />
      </main>
      <aside className="panel right">
        <Inspector />
        <ExportPanel />
      </aside>
    </div>
  );
}
