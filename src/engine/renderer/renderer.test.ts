import { BoxGeometry, Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { AssetCache } from '../assets/AssetCache';
import { setBaseplateGrid, resizeBaseplate } from '../scene/baseplate';
import { createProjectFromTemplate } from '../project/templates';
import { createSceneObject } from '../scene/factory';
import { addObjects, removeObjects, setParent, setTransform, setVisible, updateObject } from '../scene/sceneOps';
import type { SceneData } from '../scene/types';
import { pixelRatioFor } from './quality';
import { SceneSync } from './SceneSync';

const assets = new AssetCache(async () => null);

function baseplateScene(): SceneData {
  const b = createProjectFromTemplate({ name: 'R', template: 'empty-baseplate' });
  return b.scenes[b.manifest.mainSceneId] as SceneData;
}

describe('SceneSync', () => {
  it('builds a real baseplate mesh whose top surface is at y = 0', () => {
    const scene = baseplateScene();
    const sync = new SceneSync({ mode: 'editor', assets });
    sync.sync(scene);
    const bp = scene.objects.find((o) => o.type === 'baseplate')!;
    const mesh = sync.getNode(bp.id)!.content as Mesh<BoxGeometry, MeshStandardMaterial>;
    expect(mesh).toBeInstanceOf(Mesh);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(256);
    // Plain surface: no grid texture baked into the material.
    expect(mesh.material.map).toBeNull();
    expect(mesh.material.color.getHexString()).toBe('a3a7ad');
    sync.dispose();
  });

  it('updates geometry on resize and leaves the material alone when toggling the grid', () => {
    let scene = baseplateScene();
    const bp = scene.objects.find((o) => o.type === 'baseplate')!;
    const sync = new SceneSync({ mode: 'editor', assets });
    sync.sync(scene);
    const node = sync.getNode(bp.id)!;
    const material = node.material;
    const geometry = (node.content as Mesh).geometry;
    scene = setBaseplateGrid(scene, bp.id, false);
    sync.sync(scene);
    expect(node.material).toBe(material);
    expect((node.content as Mesh).geometry).toBe(geometry);
    scene = resizeBaseplate(scene, bp.id, 128, 64);
    sync.sync(scene);
    const g = (node.content as Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(64);
    expect(g.boundingBox!.max.z).toBeCloseTo(32);
    sync.dispose();
  });

  it('shows editor-only helpers in the editor but not in the game', () => {
    const scene = baseplateScene();
    const spawn = scene.objects.find((o) => o.type === 'spawnPoint')!;
    const editor = new SceneSync({ mode: 'editor', assets });
    const game = new SceneSync({ mode: 'game', assets });
    editor.sync(scene);
    game.sync(scene);
    expect(editor.getNode(spawn.id)!.helper).not.toBeNull();
    expect(game.getNode(spawn.id)!.helper).toBeNull();
    const light = scene.objects.find((o) => o.type === 'directionalLight')!;
    expect(editor.getNode(light.id)!.helper).not.toBeNull();
    expect(game.getNode(light.id)!.helper).toBeNull();
    editor.dispose();
    game.dispose();
  });

  it('applies transforms, visibility, parenting and removal incrementally', () => {
    let scene = baseplateScene();
    const a = createSceneObject('cube');
    const b = createSceneObject('sphere');
    scene = addObjects(scene, [a, b]);
    const sync = new SceneSync({ mode: 'editor', assets });
    sync.sync(scene);
    const nodeA = sync.getNode(a.id)!;
    scene = setTransform(scene, a.id, { position: [1, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] });
    scene = setVisible(scene, b.id, false);
    scene = setParent(scene, b.id, a.id);
    sync.sync(scene);
    expect(sync.getNode(a.id)).toBe(nodeA);
    expect(nodeA.root.position.toArray()).toEqual([1, 2, 3]);
    expect(nodeA.root.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(sync.getNode(b.id)!.root.parent).toBe(nodeA.root);
    expect(sync.isEffectivelyVisible(b.id)).toBe(false);
    scene = removeObjects(scene, [a.id]);
    sync.sync(scene);
    expect(sync.getNode(a.id)).toBeUndefined();
    expect(sync.getNode(b.id)).toBeUndefined();
    sync.dispose();
  });

  it('switches material classes when the style changes', () => {
    let scene = baseplateScene();
    const cube = createSceneObject('cube');
    scene = addObjects(scene, [cube]);
    const sync = new SceneSync({ mode: 'editor', assets });
    sync.sync(scene);
    expect(sync.getNode(cube.id)!.material!.type).toBe('MeshStandardMaterial');
    scene = updateObject(scene, cube.id, (o) => ({
      ...o,
      components: { ...o.components, material: { ...o.components.material!, style: 'toon', outline: true } },
    }));
    sync.sync(scene);
    expect(sync.getNode(cube.id)!.material!.type).toBe('MeshToonMaterial');
    expect(sync.getNode(cube.id)!.outline).not.toBeNull();
    sync.dispose();
  });
});

describe('Quality presets', () => {
  it('caps the pixel ratio to protect GPU memory', () => {
    expect(pixelRatioFor('low', 3)).toBe(1);
    expect(pixelRatioFor('medium', 3)).toBe(1.5);
    expect(pixelRatioFor('high', 3)).toBe(2);
    expect(pixelRatioFor('high', 1)).toBe(1);
  });
});
