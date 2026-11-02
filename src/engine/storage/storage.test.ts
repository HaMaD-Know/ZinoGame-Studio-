import { afterEach, describe, expect, it } from 'vitest';
import { createSceneObject } from '../scene/factory';
import { addObjects } from '../scene/sceneOps';
import { createProjectFromTemplate } from '../project/templates';
import type { ProjectBundle } from '../project/types';
import { exportProjectArchive, importProjectArchive } from '../serialization/projectArchive';
import { IndexedDbProjectStorage } from './IndexedDbProjectStorage';
import { MemoryProjectStorage } from './MemoryProjectStorage';
import { ProjectLoadError, type ProjectStorage } from './ProjectStorage';

let dbCounter = 0;
const backends: [string, () => ProjectStorage][] = [
  ['IndexedDB', () => new IndexedDbProjectStorage(`zino-test-${++dbCounter}`)],
  ['Memory', () => new MemoryProjectStorage()],
];

const opened: ProjectStorage[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) if (s instanceof IndexedDbProjectStorage) await s.close();
});

function addCube(bundle: ProjectBundle): ProjectBundle {
  const id = bundle.manifest.mainSceneId;
  return { ...bundle, scenes: { ...bundle.scenes, [id]: addObjects(bundle.scenes[id]!, [createSceneObject('cube', { name: 'Saved Cube' })]) } };
}

describe.each(backends)('%s project storage', (_name, make) => {
  const storage = () => {
    const s = make();
    opened.push(s);
    return s;
  };

  it('creates, saves, lists and reopens a project', async () => {
    const s = storage();
    const bundle = addCube(createProjectFromTemplate({ name: 'Reopen Me', template: 'empty-baseplate' }));
    await s.saveProject(bundle, { thumbnail: 'data:image/png;base64,AAAA' });
    const list = await s.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Reopen Me', objectCount: 5, thumbnail: 'data:image/png;base64,AAAA' });
    const { bundle: loaded, warnings } = await s.loadProject(bundle.manifest.id);
    expect(warnings).toEqual([]);
    expect(loaded).toEqual(bundle);
    // Saving again without a thumbnail keeps the previous thumbnail.
    await s.saveProject(loaded);
    expect((await s.listProjects())[0]?.thumbnail).toBe('data:image/png;base64,AAAA');
  });

  it('stores binary assets per project and deletes everything with the project', async () => {
    const s = storage();
    const bundle = createProjectFromTemplate({ name: 'Assets', template: 'empty-3d' });
    await s.saveProject(bundle);
    await s.putAsset(bundle.manifest.id, 'ast_abc123456789', new Uint8Array([1, 2, 3]).buffer, 'model/gltf-binary');
    expect(new Uint8Array((await s.getAsset(bundle.manifest.id, 'ast_abc123456789'))!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.listAssetIds(bundle.manifest.id)).toEqual(['ast_abc123456789']);
    await s.deleteProject(bundle.manifest.id);
    expect(await s.listProjects()).toEqual([]);
    expect(await s.getAsset(bundle.manifest.id, 'ast_abc123456789')).toBeNull();
    await expect(s.loadProject(bundle.manifest.id)).rejects.toBeInstanceOf(ProjectLoadError);
  });

  it('keeps a limited number of backups and restores them', async () => {
    const s = storage();
    const bundle = createProjectFromTemplate({ name: 'Backups', template: 'empty-3d' });
    for (let i = 0; i < 12; i++) await s.saveBackup({ ...bundle, manifest: { ...bundle.manifest, description: `v${i}` } }, 'autosave');
    const backups = await s.listBackups(bundle.manifest.id);
    expect(backups).toHaveLength(10);
    const restored = await s.loadBackup(backups[0]!.id);
    expect(restored.bundle.manifest.description).toBe('v11');
  });

  it('saves and clears recovery drafts', async () => {
    const s = storage();
    const bundle = createProjectFromTemplate({ name: 'Draft', template: 'empty-3d' });
    await s.saveDraft(bundle);
    expect(await s.listDrafts()).toMatchObject([{ projectId: bundle.manifest.id, name: 'Draft' }]);
    expect((await s.loadDraft(bundle.manifest.id))?.bundle.manifest.name).toBe('Draft');
    await s.clearDraft(bundle.manifest.id);
    expect(await s.loadDraft(bundle.manifest.id)).toBeNull();
  });
});

describe('Corrupt data handling', () => {
  it('reports unreadable projects and whether backups exist', async () => {
    const s = new MemoryProjectStorage();
    const bundle = createProjectFromTemplate({ name: 'Corrupt', template: 'empty-3d' });
    await s.saveProject(bundle);
    await s.saveBackup(bundle, 'open');
    s.raw.set(bundle.manifest.id, { garbage: true });
    const err = await s.loadProject(bundle.manifest.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectLoadError);
    expect((err as ProjectLoadError).hasBackups).toBe(true);
    const [backup] = await s.listBackups(bundle.manifest.id);
    expect((await s.loadBackup(backup!.id)).bundle.manifest.name).toBe('Corrupt');
  });
});

describe('Project archives', () => {
  it('round-trips a project with scripts and assets through a zip', async () => {
    const bundle = createProjectFromTemplate({ name: 'Zip / Test', template: 'playground' });
    bundle.assets.ast_model0000001 = {
      id: 'ast_model0000001',
      name: 'Robot',
      kind: 'model',
      fileName: 'robot.glb',
      mimeType: 'model/gltf-binary',
      size: 4,
      createdAt: new Date().toISOString(),
    };
    const { data, fileName, missingAssets } = await exportProjectArchive(bundle, async () => new Uint8Array([9, 8, 7, 6]).buffer);
    expect(fileName).toBe('Zip  Test.zinoproj.zip'.replace('  ', ' '));
    expect(missingAssets).toEqual([]);
    const imported = importProjectArchive(data);
    expect(imported.warnings).toEqual([]);
    expect(imported.bundle.manifest.id).toBe(bundle.manifest.id);
    expect(imported.bundle.scenes).toEqual(bundle.scenes);
    expect(imported.bundle.scripts).toEqual(bundle.scripts);
    expect(new Uint8Array(imported.assets.get('ast_model0000001')!.data)).toEqual(new Uint8Array([9, 8, 7, 6]));
    const copy = importProjectArchive(data, { newId: true });
    expect(copy.bundle.manifest.id).not.toBe(bundle.manifest.id);
  });

  it('rejects files that are not project archives', () => {
    expect(() => importProjectArchive(new Uint8Array([1, 2, 3]))).toThrow(/not a valid .zip/);
  });
});
