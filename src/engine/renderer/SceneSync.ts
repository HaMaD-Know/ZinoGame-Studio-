import {
  AxesHelper,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
  type AnimationClip,
  type Material,
} from 'three';
import { AssetCache, disposeObject } from '../assets/AssetCache';
import { DEG2RAD } from '../core/math';
import type { MaterialComponent, PrimitiveType, SceneData, SceneObject } from '../scene/types';
import { outlineGeometry, primitiveGeometry } from './geometries';
import {
  applyMaterial,
  createMaterial,
  createOutlineMaterial,
  materialMatchesStyle,
  updateOutlineMaterial,
  type RenderMaterial,
} from './materials';

/**
 * Builds Three.js objects from scene data and keeps them in sync.
 *
 * Each SceneObject gets a `root` Group holding its transform. Child scene
 * objects are attached to their parent's root, and the visual `content`
 * (mesh, light, model...) is a child of the root, so content can be rebuilt
 * without disturbing children. Updates are incremental: unchanged objects
 * (same object reference) are skipped entirely.
 */

export type SyncMode = 'editor' | 'game';

export interface SceneNode {
  id: string;
  data: SceneObject;
  root: Group;
  content: Object3D | null;
  material: RenderMaterial | null;
  outline: Mesh | null;
  helper: Object3D | null;
  /** Directional lights live in a separate rig so their shadows follow the camera. */
  sun: DirectionalLight | null;
  camera: PerspectiveCamera | null;
  animations: AnimationClip[];
  modelRequest: number;
  mapRequest: number;
  disposed: boolean;
}

export interface SceneSyncOptions {
  mode: SyncMode;
  assets: AssetCache;
  /** Called when async content (models, textures) finished loading. */
  onAsyncChange?: () => void;
  /** Called when an asset failed to load. */
  onAssetError?: (objectName: string, message: string) => void;
}

const HELPER_COLOR = new Color('#ffb02e');
const PICK_MATERIAL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
PICK_MATERIAL.userData.shared = true;

let requestCounter = 0;

function lineGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return g;
}

function pickVolume(id: string, radius: number): Mesh {
  const m = new Mesh(new SphereGeometry(radius, 8, 6), PICK_MATERIAL);
  m.userData.pickOnly = true;
  m.userData.zinoId = id;
  return m;
}

export class SceneSync {
  readonly root = new Group();
  /** Holds directional lights (and their targets) in world space. */
  readonly lightRig = new Group();
  readonly nodes = new Map<string, SceneNode>();
  private readonly helperMaterial = new MeshBasicMaterial({ color: HELPER_COLOR, depthTest: true });
  private readonly helperLineMaterial = new LineBasicMaterial({ color: HELPER_COLOR });
  private readonly spawnMaterial = new MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.55, depthWrite: false });
  private readonly sunDirection = new Vector3();

  constructor(private readonly options: SceneSyncOptions) {
    this.root.name = 'ZinoSceneRoot';
    this.lightRig.name = 'ZinoLightRig';
    this.helperMaterial.userData.shared = true;
    this.spawnMaterial.userData.shared = true;
  }

  get mode(): SyncMode {
    return this.options.mode;
  }

  sync(scene: SceneData): void {
    const ids = new Set(scene.objects.map((o) => o.id));
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) this.removeNode(id);
    for (const obj of scene.objects) {
      const node = this.nodes.get(obj.id);
      if (!node) this.createNode(obj);
      else if (node.data !== obj) this.updateNode(node, obj);
    }
    // Parenting (after all nodes exist)
    for (const obj of scene.objects) {
      const node = this.nodes.get(obj.id) as SceneNode;
      const parent = obj.parentId ? this.nodes.get(obj.parentId)?.root : undefined;
      const desired = parent ?? this.root;
      if (node.root.parent !== desired) desired.add(node.root);
    }
  }

  getNode(id: string): SceneNode | undefined {
    return this.nodes.get(id);
  }

  /** Finds the scene object id for any Three.js object inside a node. */
  objectIdFor(object: Object3D | null): string | null {
    for (let o: Object3D | null = object; o; o = o.parent) {
      if (typeof o.userData.zinoId === 'string') return o.userData.zinoId;
    }
    return null;
  }

  /** True if the object and all its ancestors are visible. */
  isEffectivelyVisible(id: string): boolean {
    for (let o: Object3D | null = this.nodes.get(id)?.root ?? null; o && o !== this.root; o = o.parent) {
      if (!o.visible) return false;
    }
    return true;
  }

  /** Moves sun lights so their shadow maps cover the area around `focus`. */
  updateSunShadows(focus: Vector3, shadowDistance: number): void {
    for (const node of this.nodes.values()) {
      const sun = node.sun;
      if (!sun) continue;
      node.root.updateWorldMatrix(true, false);
      node.root.getWorldDirection(this.sunDirection); // +Z in world space
      this.sunDirection.negate(); // lights shine along local -Z
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(this.sunDirection, -Math.max(100, shadowDistance * 2));
      const cam = sun.shadow.camera;
      if (cam.right !== shadowDistance) {
        cam.left = -shadowDistance;
        cam.right = shadowDistance;
        cam.top = shadowDistance;
        cam.bottom = -shadowDistance;
        cam.far = Math.max(400, shadowDistance * 6);
        cam.updateProjectionMatrix();
      }
      sun.visible = this.isEffectivelyVisible(node.id);
    }
  }

  setShadowMapSize(size: number): void {
    for (const node of this.nodes.values()) {
      const lights = [node.sun, node.content].filter((l): l is DirectionalLight | SpotLight =>
        !!l && ((l as DirectionalLight).isDirectionalLight || (l as SpotLight).isSpotLight),
      );
      for (const light of lights) {
        if (light.shadow.mapSize.x !== size) {
          light.shadow.mapSize.set(size, size);
          light.shadow.map?.dispose();
          light.shadow.map = null;
        }
      }
    }
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.disposed = true;
    // Re-home children so they are not disposed with this node (sync() re-parents them).
    for (const child of [...node.root.children]) {
      if (typeof child.userData.zinoId === 'string' && child.userData.zinoId !== id && child !== node.content) {
        this.root.add(child);
      }
    }
    node.root.removeFromParent();
    this.disposeContent(node);
    this.nodes.delete(id);
  }

  dispose(): void {
    for (const id of [...this.nodes.keys()]) this.removeNode(id);
    this.helperMaterial.dispose();
    this.helperLineMaterial.dispose();
    this.spawnMaterial.dispose();
    this.root.removeFromParent();
    this.lightRig.removeFromParent();
  }

  // ───────────────────────────────────────────────────────────────────────

  private createNode(obj: SceneObject): SceneNode {
    const root = new Group();
    root.name = obj.name;
    root.userData.zinoId = obj.id;
    const node: SceneNode = {
      id: obj.id,
      data: obj,
      root,
      content: null,
      material: null,
      outline: null,
      helper: null,
      sun: null,
      camera: null,
      animations: [],
      modelRequest: 0,
      mapRequest: 0,
      disposed: false,
    };
    this.nodes.set(obj.id, node);
    this.root.add(root);
    this.buildContent(node, obj);
    this.applyCommon(node, obj);
    return node;
  }

  private updateNode(node: SceneNode, obj: SceneObject): void {
    const prev = node.data;
    node.data = obj;
    const rebuild =
      prev.type !== obj.type ||
      (obj.type === 'model' && prev.components.model?.assetId !== obj.components.model?.assetId);
    if (rebuild) {
      this.disposeContent(node);
      this.buildContent(node, obj);
    } else {
      this.updateContent(node, prev, obj);
    }
    this.applyCommon(node, obj);
  }

  private applyCommon(node: SceneNode, obj: SceneObject): void {
    const { position, rotation, scale } = obj.transform;
    node.root.position.set(position[0], position[1], position[2]);
    node.root.rotation.set(rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD, 'XYZ');
    node.root.scale.set(
      Math.abs(scale[0]) < 1e-6 ? 1e-6 : scale[0],
      Math.abs(scale[1]) < 1e-6 ? 1e-6 : scale[1],
      Math.abs(scale[2]) < 1e-6 ? 1e-6 : scale[2],
    );
    node.root.visible = obj.visible;
    node.root.name = obj.name;
  }

  private buildContent(node: SceneNode, obj: SceneObject): void {
    const editor = this.options.mode === 'editor';
    switch (obj.type) {
      case 'cube':
      case 'sphere':
      case 'plane':
      case 'cylinder':
      case 'cone': {
        const material = createMaterial(obj.components.material ?? defaultSpec());
        const mesh = new Mesh(primitiveGeometry(obj.type as PrimitiveType), material);
        node.material = material;
        this.setContent(node, mesh);
        this.updateMeshFlags(node, obj);
        this.updateOutline(node, obj);
        this.updateMap(node, obj, null);
        break;
      }
      case 'baseplate': {
        const material = createMaterial(obj.components.material ?? defaultSpec());
        const mesh = new Mesh(this.baseplateGeometry(obj), material);
        mesh.name = 'BaseplateSurface';
        node.material = material;
        this.setContent(node, mesh);
        this.updateMeshFlags(node, obj);
        this.updateMap(node, obj, null);
        break;
      }
      case 'directionalLight': {
        const sun = new DirectionalLight();
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.02;
        sun.shadow.mapSize.set(1024, 1024);
        this.lightRig.add(sun, sun.target);
        node.sun = sun;
        this.updateLight(node, obj);
        if (editor) this.setHelper(node, this.sunHelper(obj.id));
        break;
      }
      case 'pointLight': {
        const light = new PointLight();
        light.shadow.bias = -0.001;
        this.setContent(node, light);
        this.updateLight(node, obj);
        if (editor) this.setHelper(node, this.pointHelper(obj.id));
        break;
      }
      case 'spotLight': {
        const light = new SpotLight();
        light.shadow.bias = -0.0005;
        light.shadow.mapSize.set(1024, 1024);
        light.target.position.set(0, 0, -1);
        light.add(light.target);
        this.setContent(node, light);
        this.updateLight(node, obj);
        if (editor) this.setHelper(node, this.spotHelper(obj.id));
        break;
      }
      case 'camera': {
        const cam = obj.components.camera;
        const camera = new PerspectiveCamera(cam?.fov ?? 60, 1, cam?.near ?? 0.1, cam?.far ?? 2000);
        node.camera = camera;
        this.setContent(node, camera);
        if (editor) this.setHelper(node, this.cameraHelper(obj.id));
        break;
      }
      case 'spawnPoint':
        if (editor || obj.components.spawn?.showInGame) this.setHelper(node, this.spawnHelper(obj.id));
        break;
      case 'empty':
        if (editor) {
          const g = new Group();
          g.add(new AxesHelper(0.8), pickVolume(obj.id, 0.4));
          this.setHelper(node, g);
        }
        break;
      case 'model':
        this.loadModel(node, obj);
        break;
    }
  }

  private updateContent(node: SceneNode, prev: SceneObject, obj: SceneObject): void {
    switch (obj.type) {
      case 'cube':
      case 'sphere':
      case 'plane':
      case 'cylinder':
      case 'cone':
      case 'baseplate': {
        const a = prev.components.baseplate;
        const b = obj.components.baseplate;
        if (obj.type === 'baseplate' && (a?.width !== b?.width || a?.depth !== b?.depth || a?.thickness !== b?.thickness)) {
          const mesh = node.content as Mesh;
          const old = mesh.geometry;
          mesh.geometry = this.baseplateGeometry(obj);
          old.dispose();
        }
        if (prev.components.material !== obj.components.material) {
          const spec = obj.components.material ?? defaultSpec();
          const mesh = node.content as Mesh;
          if (!node.material || !materialMatchesStyle(node.material, spec)) {
            const old = node.material;
            node.material = createMaterial(spec);
            mesh.material = node.material;
            old?.dispose();
          }
          this.updateMap(node, obj, prev);
          if (obj.type !== 'baseplate') this.updateOutline(node, obj);
        }
        if (prev.components.mesh !== obj.components.mesh) this.updateMeshFlags(node, obj);
        break;
      }
      case 'directionalLight':
      case 'pointLight':
      case 'spotLight':
        if (prev.components.light !== obj.components.light) this.updateLight(node, obj);
        break;
      case 'camera': {
        const cam = obj.components.camera;
        if (node.camera && cam) {
          node.camera.fov = cam.fov;
          node.camera.near = cam.near;
          node.camera.far = cam.far;
          node.camera.updateProjectionMatrix();
        }
        break;
      }
      case 'spawnPoint':
        if (this.options.mode === 'game' && prev.components.spawn?.showInGame !== obj.components.spawn?.showInGame) {
          this.disposeContent(node);
          this.buildContent(node, obj);
        }
        break;
      case 'model':
        if (prev.components.mesh !== obj.components.mesh) this.updateMeshFlags(node, obj);
        break;
      default:
        break;
    }
  }

  private setContent(node: SceneNode, object: Object3D): void {
    node.content = object;
    node.root.add(object);
  }

  private setHelper(node: SceneNode, helper: Object3D): void {
    helper.userData.editorHelper = true;
    helper.traverse((o) => {
      o.userData.editorHelper = true;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    node.helper = helper;
    node.root.add(helper);
  }

  private baseplateGeometry(obj: SceneObject): BufferGeometry {
    const bp = obj.components.baseplate;
    const w = bp?.width ?? 512;
    const d = bp?.depth ?? 512;
    const t = bp?.thickness ?? 4;
    // Top surface sits at local y = 0 so objects placed at y = 0 rest on it.
    return new BoxGeometry(w, t, d).translate(0, -t / 2, 0);
  }

  private updateMeshFlags(node: SceneNode, obj: SceneObject): void {
    const flags = obj.components.mesh ?? { castShadow: true, receiveShadow: true };
    node.content?.traverse((o) => {
      if ((o as Mesh).isMesh && !o.userData.pickOnly) {
        o.castShadow = flags.castShadow;
        o.receiveShadow = flags.receiveShadow;
      }
    });
  }

  private updateOutline(node: SceneNode, obj: SceneObject): void {
    const spec = obj.components.material;
    const mesh = node.content as Mesh | null;
    if (!spec?.outline || !mesh?.isMesh) {
      if (node.outline) {
        node.outline.removeFromParent();
        (node.outline.material as Material).dispose();
        node.outline = null;
      }
      return;
    }
    if (!node.outline) {
      node.outline = new Mesh(outlineGeometry(mesh.geometry), createOutlineMaterial(spec.outlineColor, spec.outlineWidth));
      node.outline.userData.pickOnly = false;
      node.outline.userData.isOutline = true;
      node.outline.castShadow = false;
      mesh.add(node.outline);
    } else {
      updateOutlineMaterial(node.outline.material as MeshBasicMaterial, spec.outlineColor, spec.outlineWidth);
    }
  }

  private updateMap(node: SceneNode, obj: SceneObject, prev: SceneObject | null): void {
    const spec = obj.components.material ?? defaultSpec();
    const material = node.material;
    if (!material) return;
    const mapId = spec.mapAssetId;
    if (!mapId) {
      applyMaterial(material, spec, null);
      return;
    }
    const currentMap = material.map && material.map.name === mapId ? material.map : null;
    applyMaterial(material, spec, currentMap);
    if (currentMap && prev?.components.material?.mapAssetId === mapId) return;
    const request = ++requestCounter;
    node.mapRequest = request;
    this.options.assets
      .loadTexture(mapId)
      .then((texture) => {
        if (node.disposed || node.mapRequest !== request || node.material !== material) return;
        applyMaterial(material, node.data.components.material ?? spec, texture);
        this.options.onAsyncChange?.();
      })
      .catch((err: unknown) => this.options.onAssetError?.(obj.name, (err as Error).message));
  }

  private updateLight(node: SceneNode, obj: SceneObject): void {
    const spec = obj.components.light;
    if (!spec) return;
    const light = (node.sun ?? node.content) as DirectionalLight | PointLight | SpotLight | null;
    if (!light) return;
    light.color.set(spec.color);
    light.intensity = spec.intensity;
    light.castShadow = spec.castShadow;
    if (light instanceof PointLight || light instanceof SpotLight) {
      light.distance = spec.range;
      light.decay = 2;
    }
    if (light instanceof SpotLight) {
      light.angle = Math.min(Math.PI / 2 - 0.01, spec.angle * DEG2RAD);
      light.penumbra = spec.penumbra;
    }
    if (node.helper) {
      node.helper.traverse((o) => {
        const m = (o as Mesh).material as MeshBasicMaterial | undefined;
        if (o.userData.tintWithLight && m) m.color.set(spec.color);
      });
    }
  }

  private loadModel(node: SceneNode, obj: SceneObject): void {
    const assetId = obj.components.model?.assetId;
    const placeholder = new Group();
    if (this.options.mode === 'editor') {
      const box = new LineSegments(
        lineGeometry(boxLines(1)),
        new LineBasicMaterial({ color: '#8899bb' }),
      );
      placeholder.add(box, pickVolume(obj.id, 0.6));
    }
    this.setContent(node, placeholder);
    if (!assetId) return;
    const request = ++requestCounter;
    node.modelRequest = request;
    this.options.assets
      .instantiateModel(assetId)
      .then((model) => {
        if (node.disposed || node.modelRequest !== request) {
          disposeObject(model.scene, { keepShared: true });
          return;
        }
        this.disposeContent(node, { keepHelper: true });
        model.scene.userData.zinoModel = assetId;
        node.animations = model.animations;
        this.setContent(node, model.scene);
        this.updateMeshFlags(node, node.data);
        this.options.onAsyncChange?.();
      })
      .catch((err: unknown) => {
        this.options.onAssetError?.(obj.name, (err as Error).message);
      });
  }

  private disposeContent(node: SceneNode, options: { keepHelper?: boolean } = {}): void {
    if (node.content) {
      node.content.removeFromParent();
      disposeObject(node.content, { keepShared: true });
      node.content = null;
    }
    if (node.material) {
      node.material.dispose();
      node.material = null;
    }
    if (node.outline) {
      (node.outline.material as Material).dispose();
      node.outline = null;
    }
    if (node.sun) {
      node.sun.shadow.map?.dispose();
      node.sun.dispose();
      node.sun.removeFromParent();
      node.sun.target.removeFromParent();
      node.sun = null;
    }
    node.camera = null;
    if (!options.keepHelper && node.helper) {
      node.helper.removeFromParent();
      disposeObject(node.helper, { keepShared: true });
      node.helper = null;
    }
    node.animations = [];
  }

  // ── Editor helper visuals ──────────────────────────────────────────────

  private sunHelper(id: string): Object3D {
    const g = new Group();
    const core = new Mesh(new SphereGeometry(0.45, 16, 12), new MeshBasicMaterial({ color: '#ffd166' }));
    core.userData.tintWithLight = true;
    const rays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rays.push(Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0, Math.cos(a) * 1, Math.sin(a) * 1, 0);
    }
    rays.push(0, 0, 0, 0, 0, -4);
    g.add(core, new LineSegments(lineGeometry(rays), this.helperLineMaterial), pickVolume(id, 0.9));
    return g;
  }

  private pointHelper(id: string): Object3D {
    const g = new Group();
    const core = new Mesh(new SphereGeometry(0.3, 16, 12), new MeshBasicMaterial({ color: '#ffd9a0' }));
    core.userData.tintWithLight = true;
    g.add(core, pickVolume(id, 0.6));
    return g;
  }

  private spotHelper(id: string): Object3D {
    const g = new Group();
    const cone = new Mesh(new ConeGeometry(0.4, 0.8, 16, 1, true), new MeshBasicMaterial({ color: '#ffffff', wireframe: true }));
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.4;
    cone.userData.tintWithLight = true;
    g.add(cone, new LineSegments(lineGeometry([0, 0, 0, 0, 0, -3]), this.helperLineMaterial), pickVolume(id, 0.6));
    return g;
  }

  private cameraHelper(id: string): Object3D {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(0.6, 0.45, 0.5), new MeshBasicMaterial({ color: '#5b6b8c' }));
    body.position.z = 0.25;
    const lens = new Mesh(new CylinderGeometry(0.15, 0.2, 0.25, 12), new MeshBasicMaterial({ color: '#2a3550' }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.1;
    const w = 0.9;
    const h = 0.55;
    const d = -1.6;
    const f = lineGeometry([
      0, 0, 0, -w, h, d, 0, 0, 0, w, h, d, 0, 0, 0, -w, -h, d, 0, 0, 0, w, -h, d,
      -w, h, d, w, h, d, w, h, d, w, -h, d, w, -h, d, -w, -h, d, -w, -h, d, -w, h, d,
      -0.3, h + 0.1, d, 0.3, h + 0.1, d, 0.3, h + 0.1, d, 0, h + 0.4, d, 0, h + 0.4, d, -0.3, h + 0.1, d,
    ]);
    g.add(body, lens, new LineSegments(f, new LineBasicMaterial({ color: '#c8d3ea' })), pickVolume(id, 0.7));
    return g;
  }

  private spawnHelper(id: string): Object3D {
    const g = new Group();
    const pad = new Mesh(new CylinderGeometry(1.4, 1.4, 0.08, 32), this.spawnMaterial);
    pad.position.y = -2.9;
    const arrow = new Mesh(new ConeGeometry(0.45, 0.9, 16), new MeshBasicMaterial({ color: '#3ddc84' }));
    arrow.rotation.x = Math.PI;
    arrow.position.y = -0.4;
    const stem = new Mesh(new CylinderGeometry(0.12, 0.12, 1.2, 8), new MeshBasicMaterial({ color: '#3ddc84' }));
    stem.position.y = 0.6;
    g.add(pad, arrow, stem, pickVolume(id, 1));
    return g;
  }
}

function defaultSpec(): MaterialComponent {
  return {
    style: 'standard',
    color: '#cccccc',
    metalness: 0,
    roughness: 0.6,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    mapAssetId: null,
    mapRepeat: [1, 1],
    outline: false,
    outlineColor: '#000000',
    outlineWidth: 0.04,
  };
}

function boxLines(s: number): number[] {
  const h = s / 2;
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return edges.flatMap(([a, b]) => [...(c[a as number] as number[]), ...(c[b as number] as number[])]);
}
