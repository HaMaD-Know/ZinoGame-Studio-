import { AssetCache } from '../engine/assets/AssetCache';
import type { EditorSession } from './EditorSession';

/** One asset cache per open project, shared by the viewport, play mode and previews. */
const caches = new WeakMap<EditorSession, AssetCache>();

export function assetCacheFor(session: EditorSession): AssetCache {
  let cache = caches.get(session);
  if (!cache) {
    cache = new AssetCache(session.loadAssetData);
    caches.set(session, cache);
  }
  return cache;
}

export function disposeAssetCache(session: EditorSession): void {
  caches.get(session)?.dispose();
  caches.delete(session);
}
