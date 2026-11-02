import type { Vec3 } from '../core/math';

/**
 * Scene data model.
 *
 * Everything in this file is plain, JSON-serialisable data. Scene data is
 * treated as immutable: every edit produces a new SceneData object (with
 * structural sharing), which makes undo/redo, React rendering and
 * change-detection in the 3D viewport cheap and reliable.
 */

export const SCENE_SCHEMA_VERSION = 1;

export type ObjectType =
  | 'empty'
  | 'cube'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'directionalLight'
  | 'pointLight'
  | 'spotLight'
  | 'camera'
  | 'baseplate'
  | 'spawnPoint'
  | 'model';

export const PRIMITIVE_TYPES = ['cube', 'sphere', 'plane', 'cylinder', 'cone'] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

export const LIGHT_TYPES = ['directionalLight', 'pointLight', 'spotLight'] as const;
export type LightType = (typeof LIGHT_TYPES)[number];

export interface Transform {
  position: Vec3;
  /** Euler rotation in degrees, XYZ order. */
  rotation: Vec3;
  scale: Vec3;
}

/** `standard` = realistic PBR, `toon` = cel shading, `flat` = low-poly faceted, `unlit` = no lighting. */
export type MaterialStyle = 'standard' | 'toon' | 'flat' | 'unlit';

export interface MaterialComponent {
  style: MaterialStyle;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  /** Texture asset used as base colour map. */
  mapAssetId: string | null;
  /** Texture repeat (tiling) for the base colour map. */
  mapRepeat: [number, number];
  /** Outline for stylised looks (rendered as an inverted hull). */
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
}

export interface MeshComponent {
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface LightComponent {
  color: string;
  intensity: number;
  castShadow: boolean;
  /** Point/spot light range in world units (0 = infinite). */
  range: number;
  /** Spot light cone angle in degrees. */
  angle: number;
  /** Spot light penumbra 0..1. */
  penumbra: number;
}

export interface CameraComponent {
  fov: number;
  near: number;
  far: number;
  /** The main camera is used in play mode when no player controller is active. */
  isMain: boolean;
}

export type BaseplateMaterialPreset = 'smooth' | 'concrete' | 'grass' | 'sand' | 'ice' | 'custom';

export interface BaseplateComponent {
  width: number;
  depth: number;
  thickness: number;
  /** Shows the independent editor grid on top of this baseplate. */
  showGrid: boolean;
  surface: BaseplateMaterialPreset;
}

export type ColliderShape = 'auto' | 'box' | 'sphere' | 'capsule' | 'cylinder';

export interface ColliderComponent {
  enabled: boolean;
  shape: ColliderShape;
  /** Triggers report collisions but do not block movement. */
  isTrigger: boolean;
}

export type BodyType = 'static' | 'dynamic' | 'kinematic';

export interface RigidBodyComponent {
  type: BodyType;
  mass: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
}

export interface ScriptAttachment {
  scriptId: string;
  enabled: boolean;
}

export interface ModelComponent {
  assetId: string;
  /** Animation clip to play in play mode (null = none). */
  animation: string | null;
  loopAnimation: boolean;
}

export interface SpawnComponent {
  /** Show the spawn marker in the running game (normally hidden). */
  showInGame: boolean;
}

export interface Components {
  mesh?: MeshComponent;
  material?: MaterialComponent;
  light?: LightComponent;
  camera?: CameraComponent;
  baseplate?: BaseplateComponent;
  collider?: ColliderComponent;
  rigidBody?: RigidBodyComponent;
  scripts?: ScriptAttachment[];
  model?: ModelComponent;
  spawn?: SpawnComponent;
}

export interface SceneObject {
  id: string;
  name: string;
  type: ObjectType;
  parentId: string | null;
  transform: Transform;
  visible: boolean;
  /** Locked objects cannot be selected in the viewport. */
  locked: boolean;
  components: Components;
}

export interface SkySettings {
  topColor: string;
  horizonColor: string;
  bottomColor: string;
}

export interface FogSettings {
  enabled: boolean;
  color: string;
  near: number;
  far: number;
}

export interface EnvironmentSettings {
  background: 'sky' | 'color';
  backgroundColor: string;
  sky: SkySettings;
  ambientColor: string;
  ambientIntensity: number;
  /** Image-based lighting strength for PBR materials (0 disables). */
  environmentIntensity: number;
  fog: FogSettings;
  gravity: number;
}

export interface EditorViewState {
  cameraPosition: Vec3;
  cameraTarget: Vec3;
}

export interface SceneData {
  schemaVersion: number;
  id: string;
  name: string;
  /**
   * Ordered list of objects. The order of objects with the same parent is the
   * order shown in the hierarchy.
   */
  objects: SceneObject[];
  environment: EnvironmentSettings;
  editorView: EditorViewState | null;
}
