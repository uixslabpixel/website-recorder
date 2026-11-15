import { del, get, keys, set } from 'idb-keyval';

/**
 * Binary assets (the recording and uploaded images) live in IndexedDB so a
 * refresh does not lose them. The project JSON only stores asset ids.
 */

export interface ImageAsset {
  kind: 'image';
  blob: Blob;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface VideoAsset {
  kind: 'video';
  blob: Blob;
  url: string;
}

export type Asset = ImageAsset | VideoAsset;

const PREFIX = 'asset:';
const cache = new Map<string, Asset>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribeAssets(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssetsVersion() {
  return version;
}

export function getAsset(id: string | null | undefined): Asset | undefined {
  return id ? cache.get(id) : undefined;
}

export function getImage(id: string | null | undefined): ImageAsset | undefined {
  const a = getAsset(id);
  return a?.kind === 'image' ? a : undefined;
}

export function getVideo(id: string | null | undefined): VideoAsset | undefined {
  const a = getAsset(id);
  return a?.kind === 'video' ? a : undefined;
}

async function hydrate(blob: Blob, kind: Asset['kind']): Promise<Asset> {
  if (kind === 'image') {
    const bitmap = await createImageBitmap(blob);
    return { kind, blob, bitmap, width: bitmap.width, height: bitmap.height };
  }
  return { kind, blob, url: URL.createObjectURL(blob) };
}

export async function putAsset(blob: Blob, kind: Asset['kind']): Promise<string> {
  // Decode first so an unreadable file never ends up in storage.
  const asset = await hydrate(blob, kind);
  const id = `${kind}-${crypto.randomUUID()}`;
  cache.set(id, asset);
  emit();
  try {
    await set(PREFIX + id, { kind, blob });
  } catch (err) {
    // Storage can fail (quota, private mode). The asset still works this session.
    console.warn('Could not persist asset', err);
  }
  return id;
}

export async function loadAsset(id: string): Promise<boolean> {
  if (cache.has(id)) return true;
  try {
    const stored = await get<{ kind: Asset['kind']; blob: Blob }>(PREFIX + id);
    if (!stored) return false;
    cache.set(id, await hydrate(stored.blob, stored.kind));
    emit();
    return true;
  } catch (err) {
    console.warn('Could not load asset', id, err);
    return false;
  }
}

function release(id: string) {
  const asset = cache.get(id);
  if (!asset) return;
  if (asset.kind === 'video') URL.revokeObjectURL(asset.url);
  else asset.bitmap.close();
  cache.delete(id);
}

export async function removeAsset(id: string) {
  release(id);
  emit();
  await del(PREFIX + id).catch(() => {});
}

/** Deletes every stored asset that the project no longer references. */
export async function pruneAssets(inUse: Set<string>) {
  try {
    for (const key of await keys()) {
      if (typeof key !== 'string' || !key.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length);
      if (!inUse.has(id)) {
        release(id);
        await del(key);
      }
    }
  } catch (err) {
    console.warn('Could not prune assets', err);
  }
}
