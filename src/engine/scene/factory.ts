import { createId } from '../core/ids';
import type { Vec3 } from '../core/math';
import type {
  BaseplateComponent,
  BaseplateMaterialPreset,
  ColliderComponent,
  Components,
  EnvironmentSettings,
  LightComponent,
  MaterialComponent,
  ObjectType,
  RigidBodyComponent,
  SceneData,
  SceneObject,
  Transform,
} from './types';
import { SCENE_SCHEMA_VERSION } from './types';

export const BASEPLATE_DEFAULT_SIZE = 512;
export const BASEPLATE_DEFAULT_THICKNESS = 4;
export const BASEPLATE_DEFAULT_COLOR = '#a3a7ad';
export const BASEPLATE_SIZE_PRESETS = [128, 256, 512, 1024] as const;
export const BASEPLATE_MIN_SIZE = 1;
export const BASEPLATE_MAX_SIZE = 8192;
export const DEFAULT_SPAWN_POSITION: Vec3 = [0, 3, 0];

export const BASEPLATE_SURFACES: Record<
  BaseplateMaterialPreset,
  { label: string; color: string; roughness: number; metalness: number }
> = {
  smooth: { label: 'Smooth plastic', color: BASEPLATE_DEFAULT_COLOR, roughness: 0.85, metalness: 0 },
  concrete: { label: 'Concrete', color: '#8f8f8a', roughness: 0.95, metalness: 0 },
  grass: { label: 'Grass', color: '#5f9e48', roughness: 1, metalness: 0 },
  sand: { label: 'Sand', color: '#d8c38e', roughness: 1, metalness: 0 },
  ice: { label: 'Ice', color: '#cfe8f5', roughness: 0.15, metalness: 0.05 },
  custom: { label: 'Custom', color: BASEPLATE_DEFAULT_COLOR, roughness: 0.85, metalness: 0 },
};

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  empty: 'Empty',
  cube: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  cone: 'Cone',
  directionalLight: 'Sun Light',
  pointLight: 'Point Light',
  spotLight: 'Spot Light',
  camera: 'Camera',
  baseplate: 'Baseplate',
  spawnPoint: 'Player Spawn',
  model: 'Model',
};

export function identityTransform(position: Vec3 = [0, 0, 0]): Transform {
  return { position: [...position], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function defaultMaterial(color = '#4f8cff'): MaterialComponent {
  return {
    style: 'standard',
    color,
    metalness: 0,
    roughness: 0.6,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    mapAssetId: null,
    mapRepeat: [1, 1],
    outline: false,
    outlineColor: '#1b1f2a',
    outlineWidth: 0.04,
  };
}

export function defaultCollider(): ColliderComponent {
  return { enabled: true, shape: 'auto', isTrigger: false };
}

export function defaultRigidBody(type: RigidBodyComponent['type'] = 'dynamic'): RigidBodyComponent {
  return {
    type,
    mass: 1,
    friction: 0.6,
    restitution: 0.1,
    gravityScale: 1,
    linearDamping: 0.05,
    angularDamping: 0.1,
  };
}

export function defaultLight(type: 'directionalLight' | 'pointLight' | 'spotLight'): LightComponent {
  switch (type) {
    case 'directionalLight':
      return { color: '#fff4e0', intensity: 2.2, castShadow: true, range: 0, angle: 45, penumbra: 0.3 };
    case 'pointLight':
      return { color: '#ffd9a0', intensity: 30, castShadow: false, range: 25, angle: 45, penumbra: 0.3 };
    case 'spotLight':
      return { color: '#ffffff', intensity: 60, castShadow: true, range: 40, angle: 35, penumbra: 0.4 };
  }
}

export function defaultBaseplate(): BaseplateComponent {
  return {
    width: BASEPLATE_DEFAULT_SIZE,
    depth: BASEPLATE_DEFAULT_SIZE,
    thickness: BASEPLATE_DEFAULT_THICKNESS,
    showGrid: true,
    surface: 'smooth',
  };
}

const PRIMITIVE_COLORS: Partial<Record<ObjectType, string>> = {
  cube: '#4f8cff',
  sphere: '#ff8a3d',
  plane: '#7bd389',
  cylinder: '#b57bff',
  cone: '#ffcf3d',
};

function defaultComponents(type: ObjectType): Components {
  switch (type) {
    case 'cube':
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'plane':
      return {
        mesh: { castShadow: true, receiveShadow: true },
        material: defaultMaterial(PRIMITIVE_COLORS[type]),
        collider: defaultCollider(),
      };
    case 'baseplate': {
      const material = defaultMaterial(BASEPLATE_DEFAULT_COLOR);
      material.roughness = BASEPLATE_SURFACES.smooth.roughness;
      return {
        mesh: { castShadow: false, receiveShadow: true },
        material,
        baseplate: defaultBaseplate(),
        collider: defaultCollider(),
      };
    }
    case 'directionalLight':
    case 'pointLight':
    case 'spotLight':
      return { light: defaultLight(type) };
    case 'camera':
      return { camera: { fov: 60, near: 0.1, far: 2000, isMain: false } };
    case 'spawnPoint':
      return { spawn: { showInGame: false } };
    case 'model':
      return {
        mesh: { castShadow: true, receiveShadow: true },
        model: { assetId: '', animation: null, loopAnimation: true },
        collider: { enabled: false, shape: 'box', isTrigger: false },
      };
    case 'empty':
      return {};
  }
}

function defaultTransform(type: ObjectType): Transform {
  switch (type) {
    case 'cube':
    case 'cylinder':
    case 'cone':
    case 'sphere':
      return identityTransform([0, 0.5, 0]);
    case 'plane':
      return identityTransform([0, 0.01, 0]);
    case 'directionalLight':
      return { position: [0, 30, 0], rotation: [-50, 30, 0], scale: [1, 1, 1] };
    case 'pointLight':
      return identityTransform([0, 4, 0]);
    case 'spotLight':
      return { position: [0, 8, 0], rotation: [-90, 0, 0], scale: [1, 1, 1] };
    case 'camera':
      return { position: [0, 12, 24], rotation: [-25, 0, 0], scale: [1, 1, 1] };
    case 'spawnPoint':
      return identityTransform(DEFAULT_SPAWN_POSITION);
    default:
      return identityTransform();
  }
}

export interface CreateObjectOptions {
  id?: string;
  name?: string;
  parentId?: string | null;
  transform?: Partial<Transform>;
  components?: Components;
}

export function createSceneObject(type: ObjectType, options: CreateObjectOptions = {}): SceneObject {
  const base = defaultTransform(type);
  return {
    id: options.id ?? createId('obj'),
    name: options.name ?? OBJECT_TYPE_LABELS[type],
    type,
    parentId: options.parentId ?? null,
    transform: {
      position: [...(options.transform?.position ?? base.position)],
      rotation: [...(options.transform?.rotation ?? base.rotation)],
      scale: [...(options.transform?.scale ?? base.scale)],
    },
    visible: true,
    locked: false,
    components: { ...defaultComponents(type), ...(options.components ?? {}) },
  };
}

export function createBaseplate(options: CreateObjectOptions = {}): SceneObject {
  return createSceneObject('baseplate', { name: 'Baseplate', ...options });
}

export function defaultEnvironment(): EnvironmentSettings {
  return {
    background: 'sky',
    backgroundColor: '#20263a',
    sky: { topColor: '#4a8fe7', horizonColor: '#cfe6ff', bottomColor: '#8a9bb0' },
    ambientColor: '#bcd4ff',
    ambientIntensity: 0.6,
    environmentIntensity: 0.6,
    fog: { enabled: false, color: '#cfe6ff', near: 150, far: 600 },
    gravity: -9.81,
  };
}

export function createEmptySceneData(name = 'Main Scene', id = createId('scn')): SceneData {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id,
    name,
    objects: [],
    environment: defaultEnvironment(),
    editorView: null,
  };
}
