import { createId } from '../core/ids';
import type { Vec3 } from '../core/math';
import { localTransformForParent } from './transformMath';
import type { SceneData, SceneObject, Transform } from './types';

/**
 * Pure scene operations. Each function returns a new SceneData and never
 * mutates its input, which is what makes snapshot-based undo/redo safe.
 */

export function indexById(scene: SceneData): Map<string, SceneObject> {
  return new Map(scene.objects.map((o) => [o.id, o]));
}

export function getObject(scene: SceneData, id: string): SceneObject | undefined {
  return scene.objects.find((o) => o.id === id);
}

export function childrenOf(scene: SceneData, parentId: string | null): SceneObject[] {
  return scene.objects.filter((o) => o.parentId === parentId);
}

/** Returns the ids of all descendants of `id` (not including `id`). */
export function descendantIds(scene: SceneData, id: string): string[] {
  const result: string[] = [];
  const stack = [id];
  const children = new Map<string, string[]>();
  for (const o of scene.objects) {
    if (o.parentId) {
      const list = children.get(o.parentId) ?? [];
      list.push(o.id);
      children.set(o.parentId, list);
    }
  }
  while (stack.length) {
    const current = stack.pop() as string;
    for (const child of children.get(current) ?? []) {
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

export function isDescendantOf(scene: SceneData, id: string, ancestorId: string): boolean {
  const byId = indexById(scene);
  let current = byId.get(id);
  const guard = new Set<string>();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Removes ids whose ancestor is also in the list (useful for subtree operations). */
export function topLevelIds(scene: SceneData, ids: string[]): string[] {
  const set = new Set(ids);
  const byId = indexById(scene);
  return ids.filter((id) => {
    let current = byId.get(id);
    while (current?.parentId) {
      if (set.has(current.parentId)) return false;
      current = byId.get(current.parentId);
    }
    return true;
  });
}

export function uniqueName(scene: SceneData, base: string, extraTaken: Iterable<string> = []): string {
  const taken = new Set(scene.objects.map((o) => o.name));
  for (const t of extraTaken) taken.add(t);
  if (!taken.has(base)) return base;
  const stem = base.replace(/\s\(\d+\)$/, '');
  let i = 2;
  while (taken.has(`${stem} (${i})`)) i++;
  return `${stem} (${i})`;
}

export const MAX_NAME_LENGTH = 64;

export function sanitizeObjectName(name: string): string {
  // Collapse control characters and whitespace; keep it short and printable.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export function addObjects(
  scene: SceneData,
  objects: SceneObject[],
  options: { index?: number } = {},
): SceneData {
  const existing = new Set(scene.objects.map((o) => o.id));
  for (const o of objects) {
    if (existing.has(o.id)) throw new Error(`Object id already exists: ${o.id}`);
  }
  const list = [...scene.objects];
  const index = options.index ?? list.length;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, ...objects);
  return { ...scene, objects: list };
}

export function removeObjects(scene: SceneData, ids: string[]): SceneData {
  const remove = new Set<string>();
  for (const id of ids) {
    remove.add(id);
    for (const d of descendantIds(scene, id)) remove.add(d);
  }
  if (remove.size === 0) return scene;
  return { ...scene, objects: scene.objects.filter((o) => !remove.has(o.id)) };
}

export function updateObject(
  scene: SceneData,
  id: string,
  updater: (obj: SceneObject) => SceneObject,
): SceneData {
  let changed = false;
  const objects = scene.objects.map((o) => {
    if (o.id !== id) return o;
    const next = updater(o);
    if (next !== o) changed = true;
    return next;
  });
  return changed ? { ...scene, objects } : scene;
}

export function renameObject(scene: SceneData, id: string, name: string): SceneData {
  const clean = sanitizeObjectName(name);
  if (!clean) throw new Error('Name cannot be empty');
  return updateObject(scene, id, (o) => (o.name === clean ? o : { ...o, name: clean }));
}

export function setTransform(scene: SceneData, id: string, transform: Partial<Transform>): SceneData {
  return updateObject(scene, id, (o) => ({
    ...o,
    transform: {
      position: [...(transform.position ?? o.transform.position)] as Vec3,
      rotation: [...(transform.rotation ?? o.transform.rotation)] as Vec3,
      scale: [...(transform.scale ?? o.transform.scale)] as Vec3,
    },
  }));
}

export function setVisible(scene: SceneData, id: string, visible: boolean): SceneData {
  return updateObject(scene, id, (o) => (o.visible === visible ? o : { ...o, visible }));
}

function cloneObject(o: SceneObject): SceneObject {
  return structuredClone(o);
}

/**
 * Clones subtrees rooted at `ids`, assigning fresh ids. Returns the cloned
 * objects in hierarchy order and a map from old id to new id.
 */
export function cloneSubtrees(
  scene: SceneData,
  ids: string[],
): { objects: SceneObject[]; idMap: Map<string, string>; roots: string[] } {
  const roots = topLevelIds(scene, ids);
  const include = new Set<string>();
  for (const id of roots) {
    include.add(id);
    for (const d of descendantIds(scene, id)) include.add(d);
  }
  const idMap = new Map<string, string>();
  for (const id of include) idMap.set(id, createId('obj'));
  const objects: SceneObject[] = [];
  for (const o of scene.objects) {
    if (!include.has(o.id)) continue;
    const copy = cloneObject(o);
    copy.id = idMap.get(o.id) as string;
    copy.parentId = o.parentId && idMap.has(o.parentId) ? (idMap.get(o.parentId) as string) : o.parentId;
    objects.push(copy);
  }
  return { objects, idMap, roots: roots.map((r) => idMap.get(r) as string) };
}

export function duplicateObjects(
  scene: SceneData,
  ids: string[],
  offset?: Vec3,
): { scene: SceneData; newIds: string[] } {
  if (ids.length === 0) return { scene, newIds: [] };
  const { objects, roots } = cloneSubtrees(scene, ids);
  const rootSet = new Set(roots);
  const takenNames: string[] = [];
  for (const o of objects) {
    if (!rootSet.has(o.id)) continue;
    o.name = uniqueName(scene, o.name, takenNames);
    takenNames.push(o.name);
    const delta: Vec3 =
      offset ??
      (o.type === 'baseplate' && o.components.baseplate
        ? [o.components.baseplate.width, 0, 0]
        : [1, 0, 0]);
    o.transform.position = [
      o.transform.position[0] + delta[0],
      o.transform.position[1] + delta[1],
      o.transform.position[2] + delta[2],
    ];
  }
  // Insert duplicates right after the last original subtree to keep the hierarchy tidy.
  const lastIndex = Math.max(...ids.map((id) => scene.objects.findIndex((o) => o.id === id)));
  const descendantsOfLast = new Set(descendantIds(scene, scene.objects[lastIndex]?.id ?? ''));
  let insertAt = lastIndex + 1;
  while (insertAt < scene.objects.length && descendantsOfLast.has(scene.objects[insertAt]?.id ?? '')) insertAt++;
  return { scene: addObjects(scene, objects, { index: insertAt }), newIds: roots };
}

/** Clipboard payload: plain JSON so it can be stored or shared between scenes. */
export interface ClipboardPayload {
  kind: 'zinogame-objects';
  version: 1;
  objects: SceneObject[];
  roots: string[];
}

export function copyObjects(scene: SceneData, ids: string[]): ClipboardPayload | null {
  const roots = topLevelIds(scene, ids);
  if (roots.length === 0) return null;
  const include = new Set<string>();
  for (const id of roots) {
    include.add(id);
    for (const d of descendantIds(scene, id)) include.add(d);
  }
  const objects = scene.objects.filter((o) => include.has(o.id)).map(cloneObject);
  // Detach roots from parents that are not part of the copy.
  for (const o of objects) if (roots.includes(o.id)) o.parentId = null;
  return { kind: 'zinogame-objects', version: 1, objects, roots };
}

export function pasteObjects(
  scene: SceneData,
  payload: ClipboardPayload,
  parentId: string | null = null,
): { scene: SceneData; newIds: string[] } {
  const idMap = new Map<string, string>();
  for (const o of payload.objects) idMap.set(o.id, createId('obj'));
  const taken: string[] = [];
  const objects = payload.objects.map((o) => {
    const copy = cloneObject(o);
    copy.id = idMap.get(o.id) as string;
    if (payload.roots.includes(o.id)) {
      copy.parentId = parentId;
      copy.name = uniqueName(scene, copy.name, taken);
      taken.push(copy.name);
    } else {
      copy.parentId = o.parentId ? (idMap.get(o.parentId) ?? null) : null;
    }
    return copy;
  });
  return {
    scene: addObjects(scene, objects),
    newIds: payload.roots.map((r) => idMap.get(r) as string),
  };
}

export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Moves an object (with its subtree) relative to a target in the hierarchy,
 * preserving its world transform. Returns the scene unchanged when the move
 * would create a cycle.
 */
export function moveInHierarchy(
  scene: SceneData,
  id: string,
  targetId: string | null,
  position: DropPosition,
): SceneData {
  if (id === targetId) return scene;
  const obj = getObject(scene, id);
  if (!obj) return scene;
  if (targetId && isDescendantOf(scene, targetId, id)) return scene;

  let newParentId: string | null;
  if (targetId === null) newParentId = null;
  else if (position === 'inside') newParentId = targetId;
  else newParentId = getObject(scene, targetId)?.parentId ?? null;

  const transform =
    newParentId === obj.parentId ? obj.transform : localTransformForParent(scene, id, newParentId);
  const moved: SceneObject = { ...obj, parentId: newParentId, transform };

  const subtree = new Set([id, ...descendantIds(scene, id)]);
  const block = scene.objects.filter((o) => subtree.has(o.id)).map((o) => (o.id === id ? moved : o));
  const rest = scene.objects.filter((o) => !subtree.has(o.id));

  let insertAt = rest.length;
  if (targetId) {
    const targetIndex = rest.findIndex((o) => o.id === targetId);
    if (targetIndex >= 0) {
      if (position === 'before') insertAt = targetIndex;
      else {
        // after / inside: place after the target's whole subtree
        const targetSubtree = new Set(descendantIds({ ...scene, objects: rest }, targetId));
        insertAt = targetIndex + 1;
        while (insertAt < rest.length && targetSubtree.has(rest[insertAt]?.id ?? '')) insertAt++;
      }
    }
  }
  rest.splice(insertAt, 0, ...block);
  return { ...scene, objects: rest };
}

export function setParent(scene: SceneData, id: string, parentId: string | null): SceneData {
  if (parentId === null) return moveInHierarchy(scene, id, null, 'after');
  return moveInHierarchy(scene, id, parentId, 'inside');
}

/** Returns objects ordered depth-first as shown in the hierarchy, with depth. */
export function flattenHierarchy(scene: SceneData): { object: SceneObject; depth: number }[] {
  const children = new Map<string | null, SceneObject[]>();
  const ids = new Set(scene.objects.map((o) => o.id));
  for (const o of scene.objects) {
    const key = o.parentId && ids.has(o.parentId) ? o.parentId : null;
    const list = children.get(key) ?? [];
    list.push(o);
    children.set(key, list);
  }
  const out: { object: SceneObject; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const o of children.get(parent) ?? []) {
      if (visited.has(o.id)) continue;
      visited.add(o.id);
      out.push({ object: o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function findBaseplates(scene: SceneData): SceneObject[] {
  return scene.objects.filter((o) => o.type === 'baseplate');
}

export function findSpawnPoint(scene: SceneData): SceneObject | undefined {
  return scene.objects.find((o) => o.type === 'spawnPoint');
}

/**
 * True when deleting the given objects would remove the only ground under
 * the player spawn point. Used to warn beginners before deleting a baseplate.
 */
export function deletionRemovesSpawnSupport(scene: SceneData, ids: string[]): boolean {
  const spawn = findSpawnPoint(scene);
  if (!spawn) return false;
  const removing = new Set<string>();
  for (const id of ids) {
    removing.add(id);
    for (const d of descendantIds(scene, id)) removing.add(d);
  }
  if (removing.has(spawn.id)) return false;
  const supporting = findBaseplates(scene).filter((b) => {
    const bp = b.components.baseplate;
    if (!bp || !b.visible || b.components.collider?.enabled === false) return false;
    const [x, , z] = b.transform.position;
    const [sx, , sz] = b.transform.scale;
    const [px, , pz] = spawn.transform.position;
    return Math.abs(px - x) <= (bp.width * sx) / 2 && Math.abs(pz - z) <= (bp.depth * sz) / 2;
  });
  if (supporting.length === 0) return false;
  return supporting.every((b) => removing.has(b.id));
}
