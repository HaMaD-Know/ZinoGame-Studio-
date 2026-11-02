import {
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Loads binary assets on demand and caches parsed results. Models are
 * parsed once and cloned per scene instance; textures are shared.
 * Nothing is loaded until a scene actually uses it.
 */

export type AssetDataLoader = (assetId: string) => Promise<ArrayBuffer | null>;

export interface LoadedModel {
  scene: Object3D;
  animations: AnimationClip[];
}

export class AssetCache {
  private models = new Map<string, Promise<LoadedModel>>();
  private textures = new Map<string, Promise<Texture>>();
  private disposed = false;

  constructor(private readonly loadData: AssetDataLoader) {}

  private async data(assetId: string): Promise<ArrayBuffer> {
    const buffer = await this.loadData(assetId);
    if (!buffer) throw new Error('The asset file is missing from this project');
    return buffer;
  }

  loadModel(assetId: string): Promise<LoadedModel> {
    let p = this.models.get(assetId);
    if (!p) {
      p = this.data(assetId).then((buffer) => parseModel(buffer));
      p.catch(() => this.models.delete(assetId));
      this.models.set(assetId, p);
    }
    return p;
  }

  /** Returns an independent copy of a model that can be placed in a scene. */
  async instantiateModel(assetId: string): Promise<LoadedModel> {
    const model = await this.loadModel(assetId);
    if (this.disposed) throw new Error('Asset cache was disposed');
    const scene = cloneSkinned(model.scene);
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { scene, animations: model.animations };
  }

  loadTexture(assetId: string): Promise<Texture> {
    let p = this.textures.get(assetId);
    if (!p) {
      p = this.data(assetId).then(async (buffer) => {
        const texture = await decodeTexture(buffer);
        texture.colorSpace = SRGBColorSpace;
        texture.name = assetId;
        texture.userData.shared = true;
        return texture;
      });
      p.catch(() => this.textures.delete(assetId));
      this.textures.set(assetId, p);
    }
    return p;
  }

  /** Drops a cached asset (e.g. after the asset was deleted or replaced). */
  invalidate(assetId: string): void {
    const model = this.models.get(assetId);
    this.models.delete(assetId);
    model?.then((m) => disposeObject(m.scene)).catch(() => {});
    const texture = this.textures.get(assetId);
    this.textures.delete(assetId);
    texture?.then((t) => t.dispose()).catch(() => {});
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.models.keys(), ...this.textures.keys()]) this.invalidate(id);
  }
}

export async function parseModel(buffer: ArrayBuffer): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  // Clones share geometry/materials with the cached original: mark them so
  // removing one instance never disposes data other instances still use.
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.userData.shared = true;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      m.userData.shared = true;
      for (const value of Object.values(m)) if (value instanceof Texture) value.userData.shared = true;
    }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

async function decodeTexture(buffer: ArrayBuffer): Promise<Texture> {
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  try {
    return await new TextureLoader().loadAsync(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Disposes geometries, materials and textures owned by an object tree. */
export function disposeObject(root: Object3D, options: { keepShared?: boolean } = {}): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!(options.keepShared && mesh.geometry.userData.shared)) mesh.geometry.dispose();
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (options.keepShared && m.userData.shared) continue;
      for (const value of Object.values(m)) {
        if (value instanceof Texture && !(options.keepShared && value.userData.shared)) value.dispose();
      }
      m.dispose();
    }
  });
}
