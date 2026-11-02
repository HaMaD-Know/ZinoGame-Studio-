import { describe, expect, it } from 'vitest';
import { CommandHistory } from '../history/history';
import { createProjectFromTemplate } from '../project/templates';
import { validateProjectBundle } from '../project/validation';
import {
  resetBaseplate,
  resizeBaseplate,
  setBaseplateCollision,
  setBaseplateColor,
  setBaseplateGrid,
  setBaseplateSurface,
} from './baseplate';
import { BASEPLATE_DEFAULT_SIZE, createEmptySceneData, createSceneObject } from './factory';
import {
  addObjects,
  copyObjects,
  deletionRemovesSpawnSupport,
  duplicateObjects,
  findBaseplates,
  flattenHierarchy,
  getObject,
  moveInHierarchy,
  pasteObjects,
  removeObjects,
  renameObject,
  setParent,
  setTransform,
  setVisible,
} from './sceneOps';
import { worldPositionOf } from './transformMath';
import type { SceneData } from './types';

function baseplateScene(): SceneData {
  const bundle = createProjectFromTemplate({ name: 'Test', template: 'empty-baseplate' });
  return bundle.scenes[bundle.manifest.mainSceneId] as SceneData;
}

describe('Empty Baseplate template', () => {
  it('creates baseplate, camera, sun and spawn point', () => {
    const scene = baseplateScene();
    expect(scene.objects.map((o) => o.type).sort()).toEqual(['baseplate', 'camera', 'directionalLight', 'spawnPoint']);
    expect(scene.environment.background).toBe('sky');
  });

  it('creates a 512×512 grey baseplate centred at the origin with collision', () => {
    const [bp] = findBaseplates(baseplateScene());
    expect(bp?.components.baseplate).toMatchObject({ width: 512, depth: 512, showGrid: true });
    expect(bp?.transform.position).toEqual([0, 0, 0]);
    expect(bp?.transform.rotation).toEqual([0, 0, 0]);
    expect(bp?.components.collider?.enabled).toBe(true);
    expect(bp?.components.material?.color).toBe('#a3a7ad');
  });

  it('keeps the grid independent from the surface material', () => {
    const scene = baseplateScene();
    const bp = findBaseplates(scene)[0]!;
    // The surface has no texture: the grid is an editor overlay, not part of the material.
    expect(bp.components.material?.mapAssetId).toBeNull();
    const hidden = setBaseplateGrid(scene, bp.id, false);
    const after = getObject(hidden, bp.id)!;
    expect(after.components.baseplate?.showGrid).toBe(false);
    expect(after.components.material).toEqual(bp.components.material);
  });

  it('places the spawn point above the surface', () => {
    const spawn = baseplateScene().objects.find((o) => o.type === 'spawnPoint')!;
    expect(spawn.transform.position[1]).toBeGreaterThan(0);
  });
});

describe('Baseplate editing', () => {
  it('resizes, clamps invalid sizes and changes surfaces', () => {
    const scene = baseplateScene();
    const id = findBaseplates(scene)[0]!.id;
    let s = resizeBaseplate(scene, id, 128, 1024);
    expect(getObject(s, id)?.components.baseplate).toMatchObject({ width: 128, depth: 1024 });
    s = resizeBaseplate(s, id, -5, Number.NaN);
    expect(getObject(s, id)?.components.baseplate).toMatchObject({ width: 1, depth: 1 });
    s = setBaseplateSurface(s, id, 'grass');
    expect(getObject(s, id)?.components.material?.color).toBe('#5f9e48');
    s = setBaseplateColor(s, id, '#112233');
    expect(getObject(s, id)?.components.baseplate?.surface).toBe('custom');
    expect(() => setBaseplateColor(s, id, 'red')).toThrow();
  });

  it('toggles visibility and collision, and resets to defaults', () => {
    const scene = baseplateScene();
    const id = findBaseplates(scene)[0]!.id;
    let s = setVisible(scene, id, false);
    s = setBaseplateCollision(s, id, false);
    s = resizeBaseplate(s, id, 64, 64);
    expect(getObject(s, id)).toMatchObject({ visible: false, components: { collider: { enabled: false } } });
    s = resetBaseplate(s, id);
    const reset = getObject(s, id)!;
    expect(reset.components.baseplate?.width).toBe(BASEPLATE_DEFAULT_SIZE);
    expect(reset.components.collider?.enabled).toBe(true);
    expect(reset.id).toBe(id);
  });

  it('persists collision settings through save validation', () => {
    const bundle = createProjectFromTemplate({ name: 'Persist', template: 'empty-baseplate' });
    const sceneId = bundle.manifest.mainSceneId;
    const id = findBaseplates(bundle.scenes[sceneId]!)[0]!.id;
    bundle.scenes[sceneId] = setBaseplateCollision(resizeBaseplate(bundle.scenes[sceneId]!, id, 256, 300), id, false);
    const reloaded = validateProjectBundle(JSON.parse(JSON.stringify(bundle))).bundle;
    const bp = getObject(reloaded.scenes[sceneId]!, id)!;
    expect(bp.components.collider?.enabled).toBe(false);
    expect(bp.components.baseplate).toMatchObject({ width: 256, depth: 300 });
  });

  it('warns when deleting the baseplate that supports the spawn point', () => {
    const scene = baseplateScene();
    const id = findBaseplates(scene)[0]!.id;
    expect(deletionRemovesSpawnSupport(scene, [id])).toBe(true);
    const cube = createSceneObject('cube');
    expect(deletionRemovesSpawnSupport(addObjects(scene, [cube]), [cube.id])).toBe(false);
    const removed = removeObjects(scene, [id]);
    expect(findBaseplates(removed)).toHaveLength(0);
  });
});

describe('Scene operations', () => {
  it('creates, renames, transforms and deletes objects immutably', () => {
    const scene = createEmptySceneData();
    const cube = createSceneObject('cube');
    const s1 = addObjects(scene, [cube]);
    expect(scene.objects).toHaveLength(0);
    const s2 = renameObject(s1, cube.id, '  My   Cube ');
    expect(getObject(s2, cube.id)?.name).toBe('My Cube');
    expect(() => renameObject(s2, cube.id, '   ')).toThrow();
    const s3 = setTransform(s2, cube.id, { position: [1, 2, 3] });
    expect(getObject(s3, cube.id)?.transform.position).toEqual([1, 2, 3]);
    expect(getObject(s2, cube.id)?.transform.position).toEqual([0, 0.5, 0]);
    expect(removeObjects(s3, [cube.id]).objects).toHaveLength(0);
  });

  it('duplicates subtrees with new ids and unique names', () => {
    const parent = createSceneObject('cube', { name: 'Parent' });
    const child = createSceneObject('sphere', { name: 'Child', parentId: parent.id });
    const scene = addObjects(createEmptySceneData(), [parent, child]);
    const { scene: s, newIds } = duplicateObjects(scene, [parent.id]);
    expect(s.objects).toHaveLength(4);
    const copy = getObject(s, newIds[0]!)!;
    expect(copy.name).toBe('Parent (2)');
    expect(copy.id).not.toBe(parent.id);
    const copiedChild = s.objects.find((o) => o.parentId === copy.id);
    expect(copiedChild?.name).toBe('Child');
  });

  it('copies and pastes objects', () => {
    const cube = createSceneObject('cube');
    const scene = addObjects(createEmptySceneData(), [cube]);
    const payload = copyObjects(scene, [cube.id])!;
    const { scene: s, newIds } = pasteObjects(scene, JSON.parse(JSON.stringify(payload)));
    expect(s.objects).toHaveLength(2);
    expect(getObject(s, newIds[0]!)?.name).toBe('Cube (2)');
  });

  it('parents and unparents while keeping world position', () => {
    const parent = createSceneObject('empty', { transform: { position: [10, 0, 0], rotation: [0, 90, 0] } });
    const cube = createSceneObject('cube', { transform: { position: [12, 1, 0] } });
    let scene = addObjects(createEmptySceneData(), [parent, cube]);
    scene = setParent(scene, cube.id, parent.id);
    expect(getObject(scene, cube.id)?.parentId).toBe(parent.id);
    const world = worldPositionOf(scene, cube.id);
    expect(world[0]).toBeCloseTo(12);
    expect(world[1]).toBeCloseTo(1);
    scene = setParent(scene, cube.id, null);
    expect(getObject(scene, cube.id)?.transform.position[0]).toBeCloseTo(12);
  });

  it('refuses to create hierarchy cycles', () => {
    const a = createSceneObject('empty', { name: 'A' });
    const b = createSceneObject('empty', { name: 'B', parentId: a.id });
    const scene = addObjects(createEmptySceneData(), [a, b]);
    expect(moveInHierarchy(scene, a.id, b.id, 'inside')).toBe(scene);
  });

  it('reorders siblings and flattens the hierarchy depth-first', () => {
    const a = createSceneObject('cube', { name: 'A' });
    const b = createSceneObject('cube', { name: 'B' });
    const c = createSceneObject('cube', { name: 'C', parentId: a.id });
    let scene = addObjects(createEmptySceneData(), [a, b, c]);
    expect(flattenHierarchy(scene).map((e) => `${e.object.name}:${e.depth}`)).toEqual(['A:0', 'C:1', 'B:0']);
    scene = moveInHierarchy(scene, b.id, a.id, 'before');
    expect(flattenHierarchy(scene).map((e) => e.object.name)).toEqual(['B', 'A', 'C']);
  });

  it('deleting a parent deletes its children', () => {
    const a = createSceneObject('cube');
    const b = createSceneObject('cube', { parentId: a.id });
    const scene = addObjects(createEmptySceneData(), [a, b]);
    expect(removeObjects(scene, [a.id]).objects).toHaveLength(0);
  });
});

describe('Undo / redo history', () => {
  it('undoes and redoes snapshots in order', () => {
    const history = new CommandHistory<SceneData>();
    const s0 = createEmptySceneData();
    const cube = createSceneObject('cube');
    const s1 = addObjects(s0, [cube]);
    history.record({ label: 'Add cube', before: s0, after: s1, selectionBefore: [], selectionAfter: [cube.id] });
    const s2 = renameObject(s1, cube.id, 'Box');
    history.record({ label: 'Rename', before: s1, after: s2, selectionBefore: [cube.id], selectionAfter: [cube.id] });
    expect(history.undo()?.before).toBe(s1);
    expect(history.undo()?.before).toBe(s0);
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.after).toBe(s1);
    expect(history.redoLabel).toBe('Rename');
  });

  it('merges rapid edits with the same key and clears redo on new edits', () => {
    let t = 0;
    const history = new CommandHistory<number>({ now: () => t });
    history.record({ label: 'x', before: 0, after: 1, mergeKey: 'pos', selectionBefore: [], selectionAfter: [] });
    t = 100;
    history.record({ label: 'x', before: 1, after: 2, mergeKey: 'pos', selectionBefore: [], selectionAfter: [] });
    expect(history.size.undo).toBe(1);
    expect(history.undo()).toMatchObject({ before: 0, after: 2 });
    history.record({ label: 'y', before: 0, after: 5, selectionBefore: [], selectionAfter: [] });
    expect(history.canRedo).toBe(false);
  });

  it('ignores no-op changes', () => {
    const history = new CommandHistory<number>();
    expect(history.record({ label: 'noop', before: 1, after: 1, selectionBefore: [], selectionAfter: [] })).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
