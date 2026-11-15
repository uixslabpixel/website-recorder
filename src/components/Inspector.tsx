import { useRef, useState } from 'react';
import { getImage, putAsset, removeAsset } from '../lib/assets';
import { CANVAS_PRESETS, RECORDING_LAYER_ID, useProject, useUi, type Background } from '../store';
import { Color, Icon, IconButton, Notice, Num, Row, Section, Segmented, Slider, Toggle } from './controls';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${Math.round(v)}px`;

function useImagePicker(onPicked: (assetId: string, name: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          setError(null);
          onPicked(await putAsset(file, 'image'), file.name);
        } catch {
          setError(`“${file.name}” is not an image this browser can read.`);
        }
      }}
    />
  );
  return { open: () => ref.current?.click(), input, error };
}

function CanvasSection() {
  const canvas = useProject((s) => s.canvas);
  const set = useProject((s) => s.set);
  const preset = CANVAS_PRESETS.find((c) => c.width === canvas.width && c.height === canvas.height);
  return (
    <Section title="Canvas">
      <Row label="Preset">
        <select
          value={preset?.label ?? 'custom'}
          onChange={(e) => {
            const c = CANVAS_PRESETS.find((x) => x.label === e.target.value);
            if (c) set({ canvas: { width: c.width, height: c.height } });
          }}
        >
          {CANVAS_PRESETS.map((c) => (
            <option key={c.label} value={c.label}>
              {c.label}
            </option>
          ))}
          {!preset && <option value="custom">Custom</option>}
        </select>
      </Row>
      <div className="row">
        <span className="label">Size</span>
        <span className="control pair">
          <Num prefix="W" label="Canvas width" value={canvas.width} min={200} max={4096} onChange={(width) => set({ canvas: { ...canvas, width: Math.round(width) } })} />
          <Num prefix="H" label="Canvas height" value={canvas.height} min={200} max={4096} onChange={(height) => set({ canvas: { ...canvas, height: Math.round(height) } })} />
        </span>
      </div>
    </Section>
  );
}

const GRADIENTS: [string, string][] = [
  ['#6d5efc', '#f472b6'],
  ['#0ea5e9', '#22d3ee'],
  ['#f97316', '#facc15'],
  ['#10b981', '#a3e635'],
  ['#1e293b', '#475569'],
  ['#fda4af', '#fde68a'],
];

function BackgroundSection() {
  const bg = useProject((s) => s.background);
  const set = useProject((s) => s.set);
  const setBg = (background: Background) => set({ background });
  const picker = useImagePicker((assetId) => {
    if (bg.type === 'image' && bg.assetId) void removeAsset(bg.assetId);
    setBg({ type: 'image', assetId });
  });
  const image = bg.type === 'image' ? getImage(bg.assetId) : undefined;

  return (
    <Section title="Background">
      <Segmented
        value={bg.type}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'image', label: 'Image' },
        ]}
        onChange={(type) => {
          if (type === bg.type) return;
          if (bg.type === 'image' && bg.assetId) void removeAsset(bg.assetId);
          if (type === 'solid') setBg({ type, color: bg.type === 'gradient' ? bg.from : '#6d5efc' });
          else if (type === 'gradient') setBg({ type, from: bg.type === 'solid' ? bg.color : '#6d5efc', to: '#f472b6', angle: 135 });
          else setBg({ type, assetId: null });
        }}
      />
      {bg.type === 'solid' && (
        <Row label="Color">
          <Color value={bg.color} onChange={(color) => setBg({ ...bg, color })} />
        </Row>
      )}
      {bg.type === 'gradient' && (
        <>
          <div className="swatches">
            {GRADIENTS.map(([from, to]) => (
              <button
                key={from + to}
                type="button"
                aria-label={`Gradient ${from} to ${to}`}
                aria-pressed={bg.from === from && bg.to === to}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                onClick={() => setBg({ ...bg, from, to })}
              />
            ))}
          </div>
          <Row label="From">
            <Color value={bg.from} onChange={(from) => setBg({ ...bg, from })} />
          </Row>
          <Row label="To">
            <Color value={bg.to} onChange={(to) => setBg({ ...bg, to })} />
          </Row>
          <Slider label="Angle" value={bg.angle} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(angle) => setBg({ ...bg, angle })} />
        </>
      )}
      {bg.type === 'image' && (
        <>
          <button type="button" className="wide" onClick={picker.open} data-tip={image ? `${image.width}×${image.height}, scaled to cover the canvas` : undefined}>
            <Icon name="upload" />
            {image ? 'Replace image' : 'Upload image'}
          </button>
          {picker.input}
          {picker.error && <Notice tone="error">{picker.error}</Notice>}
        </>
      )}
    </Section>
  );
}

function TransformFields({ t, onChange }: { t: { x: number; y: number; scale: number }; onChange: (patch: { x?: number; y?: number; scale?: number }) => void }) {
  return (
    <>
      <Slider label="Scale" value={t.scale} min={0.05} max={1.5} step={0.005} format={percent} onChange={(scale) => onChange({ scale })} />
      <Slider label="X" value={t.x} min={-0.75} max={0.75} step={0.005} format={percent} onChange={(x) => onChange({ x })} />
      <Slider label="Y" value={t.y} min={-0.75} max={0.75} step={0.005} format={percent} onChange={(y) => onChange({ y })} />
    </>
  );
}

function LayersSection() {
  const { order, imageLayers, recordingLayer: rl, setRecordingLayer, updateImageLayer, removeImageLayer, moveLayer, addImageLayer } = useProject();
  const { selected, select } = useUi();
  const picker = useImagePicker((assetId, name) => select(addImageLayer(assetId, name)));
  const top = [...order].reverse();
  const image = imageLayers.find((l) => l.id === selected);

  return (
    <>
      <Section title="Layers" action={<IconButton icon="plus" label="Add image" onClick={picker.open} />}>
        {picker.input}
        {picker.error && <Notice tone="error">{picker.error}</Notice>}
        <ul className="layers">
          {top.map((id, i) => {
            const layer = imageLayers.find((l) => l.id === id);
            const name = id === RECORDING_LAYER_ID ? 'Recording' : (layer?.name ?? 'Image');
            return (
              <li key={id} className={selected === id ? 'selected' : ''}>
                <button type="button" className="layer-name" onClick={() => select(id)} aria-pressed={selected === id}>
                  <Icon name={id === RECORDING_LAYER_ID ? 'video' : 'image'} />
                  <span>{name}</span>
                </button>
                {top.length > 1 && (
                  <>
                    <IconButton icon="up" label={`Bring ${name} forward`} disabled={i === 0} onClick={() => moveLayer(id, 1)} />
                    <IconButton icon="down" label={`Send ${name} backward`} disabled={i === top.length - 1} onClick={() => moveLayer(id, -1)} />
                  </>
                )}
                {layer && (
                  <IconButton
                    icon="trash"
                    label={`Delete ${name}`}
                    onClick={() => {
                      removeImageLayer(id);
                      void removeAsset(layer.assetId);
                      if (selected === id) select(RECORDING_LAYER_ID);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {image ? (
        <Section id="layer" title={image.name} action={<IconButton icon="center" label="Center on canvas" onClick={() => updateImageLayer(image.id, { x: 0, y: 0 })} />}>
          <TransformFields t={image} onChange={(patch) => updateImageLayer(image.id, patch)} />
          <Slider label="Radius" value={image.radius} min={0} max={200} step={1} format={px} onChange={(radius) => updateImageLayer(image.id, { radius })} />
        </Section>
      ) : (
        <Section id="layer" title="Recording" action={<IconButton icon="center" label="Center on canvas" onClick={() => setRecordingLayer({ x: 0, y: 0 })} />}>
          <TransformFields t={rl} onChange={setRecordingLayer} />
          <Slider label="Radius" value={rl.radius} min={0} max={120} step={1} format={px} onChange={(radius) => setRecordingLayer({ radius })} />
          <Row label="Shadow">
            <Toggle checked={rl.shadow} onChange={(shadow) => setRecordingLayer({ shadow })} />
          </Row>
          {rl.shadow && (
            <>
              <Slider label="Blur" value={rl.shadowBlur} min={0} max={200} step={1} format={px} onChange={(shadowBlur) => setRecordingLayer({ shadowBlur })} />
              <Slider label="Offset" value={rl.shadowOffsetY} min={0} max={120} step={1} format={px} onChange={(shadowOffsetY) => setRecordingLayer({ shadowOffsetY })} />
              <Slider label="Opacity" value={rl.shadowOpacity} min={0} max={1} step={0.01} format={percent} onChange={(shadowOpacity) => setRecordingLayer({ shadowOpacity })} />
            </>
          )}
        </Section>
      )}
    </>
  );
}

export function Inspector() {
  return (
    <>
      <CanvasSection />
      <BackgroundSection />
      <LayersSection />
    </>
  );
}
