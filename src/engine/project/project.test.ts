import { describe, expect, it } from 'vitest';
import { compileScriptDoc } from '../scripting/scriptDoc';
import { createExampleProject, createProjectFromTemplate, EXAMPLE_PROJECTS, PROJECT_TEMPLATES } from './templates';
import { projectNameError, ProjectValidationError, validateProjectBundle } from './validation';

describe('Project templates', () => {
  it.each(PROJECT_TEMPLATES.map((t) => t.id))('creates a valid "%s" project', (template) => {
    const bundle = createProjectFromTemplate({ name: 'My Game', description: 'desc', template });
    expect(bundle.manifest.name).toBe('My Game');
    expect(bundle.manifest.mainSceneId).toBeTruthy();
    expect(bundle.scenes[bundle.manifest.mainSceneId]).toBeDefined();
    const { warnings } = validateProjectBundle(JSON.parse(JSON.stringify(bundle)));
    expect(warnings).toEqual([]);
  });

  it('defaults to the Empty Baseplate template', () => {
    expect(PROJECT_TEMPLATES.find((t) => t.recommended)?.id).toBe('empty-baseplate');
  });

  it.each(EXAMPLE_PROJECTS.map((e) => e.id))('builds example "%s" with compiling scripts', (id) => {
    const bundle = createExampleProject(id);
    for (const script of Object.values(bundle.scripts)) {
      const compiled = compileScriptDoc(script);
      expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(compiled.program).not.toBeNull();
    }
    const attached = Object.values(bundle.scenes)
      .flatMap((s) => s.objects)
      .flatMap((o) => o.components.scripts ?? []);
    for (const a of attached) expect(bundle.scripts[a.scriptId]).toBeDefined();
  });
});

describe('Project validation', () => {
  it('validates project names', () => {
    expect(projectNameError('')).toMatch(/name/);
    expect(projectNameError('a/b')).toMatch(/cannot contain/);
    expect(projectNameError('x'.repeat(65))).toMatch(/64/);
    expect(projectNameError('Space Race 2')).toBeNull();
  });

  it('rejects non-projects and future versions', () => {
    expect(() => validateProjectBundle(null)).toThrow(ProjectValidationError);
    expect(() => validateProjectBundle({ manifest: { format: 'other' } })).toThrow(/not a ZinoGame project/);
    const bundle = createProjectFromTemplate({ name: 'Future', template: 'empty-3d' });
    const future = JSON.parse(JSON.stringify(bundle));
    future.manifest.schemaVersion = 99;
    expect(() => validateProjectBundle(future)).toThrow(/newer version/);
  });

  it('repairs damaged data instead of losing the project', () => {
    const bundle = createProjectFromTemplate({ name: 'Damaged', template: 'empty-baseplate' });
    const raw = JSON.parse(JSON.stringify(bundle));
    const scene = raw.scenes[raw.manifest.mainSceneId];
    scene.objects.push({ id: 'not valid', name: 'Bad' });
    scene.objects.push({ ...scene.objects[1], id: scene.objects[1].id });
    scene.objects[0].transform.position = ['a', 2];
    scene.objects[0].components.material.color = 'green';
    scene.objects[1].parentId = 'obj_doesnotexist';
    raw.manifest.mainSceneId = 'scn_missing000';
    const { bundle: fixed, warnings } = validateProjectBundle(raw);
    const s = fixed.scenes[fixed.manifest.mainSceneId]!;
    expect(s.objects).toHaveLength(4);
    expect(s.objects[0]!.transform.position).toEqual([0, 0, 0]);
    expect(s.objects[0]!.components.material?.color).toMatch(/^#/);
    expect(s.objects[1]!.parentId).toBeNull();
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('breaks parenting loops', () => {
    const bundle = createProjectFromTemplate({ name: 'Loop', template: 'empty-3d' });
    const raw = JSON.parse(JSON.stringify(bundle));
    const objs = raw.scenes[raw.manifest.mainSceneId].objects;
    objs[0].parentId = objs[1].id;
    objs[1].parentId = objs[0].id;
    const { bundle: fixed } = validateProjectBundle(raw);
    const fixedObjs = fixed.scenes[fixed.manifest.mainSceneId]!.objects;
    expect(fixedObjs.some((o) => o.parentId === null)).toBe(true);
  });

  it('migrates the v0 preview format', () => {
    const bundle = createProjectFromTemplate({ name: 'Old', template: 'empty-baseplate' });
    const raw = JSON.parse(JSON.stringify(bundle));
    delete raw.manifest.schemaVersion;
    raw.manifest.version = 0;
    raw.scenes = Object.values(raw.scenes);
    const bp = raw.scenes[0].objects.find((o: { type: string }) => o.type === 'baseplate');
    bp.components.baseplate = { size: 300, thickness: 4, showGrid: true, surface: 'smooth' };
    const { bundle: migrated, warnings } = validateProjectBundle(raw);
    const scene = Object.values(migrated.scenes)[0]!;
    expect(scene.objects.find((o) => o.type === 'baseplate')?.components.baseplate).toMatchObject({ width: 300, depth: 300 });
    expect(migrated.manifest.schemaVersion).toBe(1);
    expect(warnings.join()).toMatch(/v0/);
  });
});
