import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromTemplate } from '../engine/project/templates';
import { MemoryProjectStorage } from '../engine/storage/MemoryProjectStorage';
import { getObject } from '../engine/scene/sceneOps';
import { EditorSession } from './EditorSession';

function makeSession(autosave = { enabled: true, delayMs: 1000 }) {
  const storage = new MemoryProjectStorage();
  const project = createProjectFromTemplate({ name: 'Session', template: 'empty-baseplate' });
  const session = new EditorSession(project, { storage, autosave });
  return { storage, session, project };
}

describe('EditorSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates objects, selects them and undoes/redoes consistently', () => {
    const { session } = makeSession();
    const cube = session.createObject('cube', { at: [4, 0, 4] })!;
    expect(session.getState().selection).toEqual([cube.id]);
    expect(getObject(session.scene, cube.id)?.transform.position).toEqual([4, 0.5, 4]);
    session.rename(cube.id, 'Hero Box');
    session.setTransform(cube.id, { scale: [2, 2, 2] });
    expect(session.getState().undoLabel).toBe('Change transform');
    session.undo();
    expect(getObject(session.scene, cube.id)?.transform.scale).toEqual([1, 1, 1]);
    session.undo();
    expect(getObject(session.scene, cube.id)?.name).toBe('Cube');
    session.undo();
    expect(getObject(session.scene, cube.id)).toBeUndefined();
    expect(session.getState().selection).toEqual([]);
    session.redo();
    expect(getObject(session.scene, cube.id)).toBeDefined();
    expect(session.getState().selection).toEqual([cube.id]);
  });

  it('records a single undo step for a gizmo drag preview + commit', () => {
    const { session } = makeSession();
    const cube = session.createObject('cube')!;
    const t = getObject(session.scene, cube.id)!.transform;
    for (let i = 1; i <= 5; i++) session.previewTransforms([{ id: cube.id, after: { ...t, position: [i, 0.5, 0] } }]);
    session.commitTransforms([{ id: cube.id, after: { ...t, position: [5, 0.5, 0] } }]);
    expect(getObject(session.scene, cube.id)?.transform.position).toEqual([5, 0.5, 0]);
    session.undo();
    expect(getObject(session.scene, cube.id)?.transform.position).toEqual([0, 0.5, 0]);
  });

  it('duplicates, copies, pastes, groups and deletes', () => {
    const { session } = makeSession();
    const cube = session.createObject('cube')!;
    const [dup] = session.duplicateObjects([cube.id]);
    expect(getObject(session.scene, dup!)?.name).toBe('Cube (2)');
    session.copy([cube.id]);
    const [pasted] = session.paste();
    expect(pasted).toBeDefined();
    session.select([cube.id, dup!]);
    const group = session.groupSelection()!;
    expect(getObject(session.scene, cube.id)?.parentId).toBe(group);
    session.deleteObjects([group]);
    expect(getObject(session.scene, cube.id)).toBeUndefined();
  });

  it('autosaves after a short delay and reports status', async () => {
    const { session, storage, project } = makeSession();
    session.createObject('sphere');
    expect(session.getState().saveStatus).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(1100);
    expect(session.getState().saveStatus).toBe('saved');
    const loaded = await storage.loadProject(project.manifest.id);
    expect(loaded.bundle.scenes[project.manifest.mainSceneId]?.objects.some((o) => o.type === 'sphere')).toBe(true);
  });

  it('keeps a recovery draft when autosave is off', async () => {
    const { session, storage, project } = makeSession({ enabled: false, delayMs: 1000 });
    session.createObject('cone');
    await vi.advanceTimersByTimeAsync(3500);
    expect(session.getState().saveStatus).toBe('unsaved');
    const draft = await storage.loadDraft(project.manifest.id);
    expect(draft?.bundle.scenes[project.manifest.mainSceneId]?.objects.some((o) => o.type === 'cone')).toBe(true);
    await session.save();
    expect(await storage.loadDraft(project.manifest.id)).toBeNull();
  });

  it('reports save failures', async () => {
    const { session, storage } = makeSession();
    vi.spyOn(storage, 'saveProject').mockRejectedValueOnce(new Error('Disk full'));
    session.createObject('cube');
    expect(await session.save()).toBe(false);
    expect(session.getState()).toMatchObject({ saveStatus: 'error', saveError: 'Disk full' });
    expect(session.getState().console.at(-1)?.message).toMatch(/Disk full/);
  });

  it('locks editing during play mode', () => {
    const { session } = makeSession();
    session.setPlayState('playing');
    expect(session.createObject('cube')).toBeNull();
    session.setPlayState('edit');
    expect(session.createObject('cube')).not.toBeNull();
  });

  it('attaches scripts and removes them from objects when the script is deleted', () => {
    const { session } = makeSession();
    const cube = session.createObject('cube')!;
    const script = session.createScript('Spin', 'blocks');
    session.attachScript(cube.id, script.id);
    expect(session.objectsUsingScript(script.id)).toHaveLength(1);
    session.deleteScript(script.id);
    expect(getObject(session.scene, cube.id)?.components.scripts).toEqual([]);
    expect(session.project.scripts[script.id]).toBeUndefined();
  });
});
