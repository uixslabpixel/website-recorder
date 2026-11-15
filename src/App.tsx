import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconButton, Tooltips, useDismiss } from './components/controls';
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
  const confirmRef = useRef<HTMLDivElement>(null);
  useDismiss(confirmRef, confirming, () => setConfirming(false));

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
          <span className="logo" aria-hidden />
          Recorder
        </h1>
        <span className="spacer" />
        <div className="menu" ref={confirmRef}>
          <IconButton icon="fresh" label="New project" onClick={() => setConfirming(!confirming)} />
          {confirming && (
            <div className="popover confirm" role="alertdialog" aria-label="Discard this project?">
              <p>Discard this project?</p>
              <button type="button" className="small" onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button type="button" className="small danger" onClick={newProject}>
                Discard
              </button>
            </div>
          )}
        </div>
        <ExportPanel />
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
      </aside>
      <Tooltips />
    </div>
  );
}
