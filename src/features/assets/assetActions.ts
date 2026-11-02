import type { EditorSession } from '../../editor/EditorSession';
import { createId } from '../../engine/core/ids';
import type { Vec3 } from '../../engine/core/math';
import type { AssetMeta } from '../../engine/project/types';
import { createSceneObject } from '../../engine/scene/factory';
import { copyObjects, pasteObjects, uniqueName } from '../../engine/scene/sceneOps';

/** Places a model or prefab asset in the scene (models rest on the ground). */
export function placeAssetInScene(session: EditorSession, asset: AssetMeta, at: Vec3 = [0, 0, 0]): string | null {
  if (asset.kind === 'model') {
    const info = asset.model;
    const lift = info ? -info.boundsMin[1] : 0;
    const obj = createSceneObject('model', {
      name: uniqueName(session.scene, asset.name),
      transform: { position: [at[0], at[1] + lift, at[2]] },
      components: {
        mesh: { castShadow: true, receiveShadow: true },
        model: { assetId: asset.id, animation: info?.animations[0] ?? null, loopAnimation: true },
        collider: { enabled: false, shape: 'box', isTrigger: false },
      },
    });
    session.addObjectsFromTemplate(`Add ${asset.name}`, [obj], [obj.id]);
    return obj.id;
  }
  if (asset.kind === 'prefab' && asset.prefab) {
    let newIds: string[] = [];
    session.applySceneChange(`Add ${asset.name}`, (scene) => {
      const result = pasteObjects(scene, { kind: 'zinogame-objects', version: 1, objects: asset.prefab!.objects, roots: asset.prefab!.roots });
      newIds = result.newIds;
      let next = result.scene;
      // Move the prefab to the requested spot.
      next = {
        ...next,
        objects: next.objects.map((o) =>
          newIds.includes(o.id)
            ? { ...o, transform: { ...o.transform, position: [o.transform.position[0] + at[0], o.transform.position[1], o.transform.position[2] + at[2]] as Vec3 } }
            : o,
        ),
      };
      return next;
    });
    if (newIds.length) session.select(newIds);
    return newIds[0] ?? null;
  }
  return null;
}

/** Saves the selected objects as a reusable prefab asset. */
export async function createPrefabFromSelection(session: EditorSession, name: string): Promise<AssetMeta | null> {
  const payload = copyObjects(session.scene, session.getState().selection);
  if (!payload) return null;
  // Centre the prefab on the origin horizontally so it is placed where the user is looking.
  const roots = new Set(payload.roots);
  const rootObjs = payload.objects.filter((o) => roots.has(o.id));
  const cx = rootObjs.reduce((s, o) => s + o.transform.position[0], 0) / Math.max(1, rootObjs.length);
  const cz = rootObjs.reduce((s, o) => s + o.transform.position[2], 0) / Math.max(1, rootObjs.length);
  for (const o of rootObjs) o.transform.position = [o.transform.position[0] - cx, o.transform.position[1], o.transform.position[2] - cz];
  const asset: AssetMeta = {
    id: createId('ast'),
    name: name.trim().slice(0, 96) || 'Prefab',
    kind: 'prefab',
    fileName: '',
    mimeType: 'application/json',
    size: 0,
    createdAt: new Date().toISOString(),
    prefab: { objects: payload.objects, roots: payload.roots },
  };
  await session.addAsset(asset, null);
  return asset;
}

/** Saves the material of the selected object as a reusable material asset. */
export async function createMaterialFromSelection(session: EditorSession, name: string): Promise<AssetMeta | null> {
  const obj = session.selectedObjects[0];
  const material = obj?.components.material;
  if (!material) return null;
  const asset: AssetMeta = {
    id: createId('ast'),
    name: name.trim().slice(0, 96) || 'Material',
    kind: 'material',
    fileName: '',
    mimeType: 'application/json',
    size: 0,
    createdAt: new Date().toISOString(),
    material: { ...material },
  };
  await session.addAsset(asset, null);
  return asset;
}

/** Applies a material or texture asset to every selected object that has a material. */
export function applyAssetToSelection(session: EditorSession, asset: AssetMeta): number {
  const targets = session.selectedObjects.filter((o) => o.components.material);
  if (targets.length === 0) return 0;
  session.applySceneChange(`Apply ${asset.name}`, (scene) => ({
    ...scene,
    objects: scene.objects.map((o) => {
      if (!targets.some((t) => t.id === o.id) || !o.components.material) return o;
      const material =
        asset.kind === 'material' && asset.material
          ? { ...asset.material }
          : asset.kind === 'texture'
            ? { ...o.components.material, mapAssetId: asset.id }
            : o.components.material;
      return { ...o, components: { ...o.components, material } };
    }),
  }));
  return targets.length;
}
