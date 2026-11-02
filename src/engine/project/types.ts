import type { MaterialComponent, SceneData, SceneObject } from '../scene/types';

/**
 * ZinoGame project format (schema version 1).
 * See docs/PROJECT_FORMAT.md for the on-disk layout used by import/export.
 */

export const PROJECT_FORMAT_ID = 'zinogame-project';
export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectTemplateId = 'empty-baseplate' | 'empty-3d' | 'playground' | 'example';

export type CameraMode = 'thirdPerson' | 'firstPerson';

export interface PlayerSettings {
  /** Spawn a controllable player at the spawn point in play mode. */
  enabled: boolean;
  moveSpeed: number;
  jumpPower: number;
  cameraMode: CameraMode;
  color: string;
}

export interface ProjectSettings {
  player: PlayerSettings;
  /** Visual direction hint used for new objects and lighting defaults. */
  renderStyle: 'realistic' | 'stylized';
  /** Show the score counter in play mode. */
  showScore: boolean;
}

export interface ProjectManifest {
  format: typeof PROJECT_FORMAT_ID;
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  template: ProjectTemplateId;
  createdAt: string;
  updatedAt: string;
  /** Version of ZinoGame Studio that last saved the project. */
  appVersion: string;
  mainSceneId: string;
  sceneIds: string[];
  settings: ProjectSettings;
}

export type ScriptMode = 'blocks' | 'text';

export interface ScriptDoc {
  id: string;
  name: string;
  mode: ScriptMode;
  /** Zino Script source text. In blocks mode this is generated from the blocks. */
  source: string;
  /** Blockly workspace JSON (only used in blocks mode). */
  blocks: unknown;
  /**
   * Text saved just before a text→blocks conversion, so user-written code is
   * never lost even if the conversion reformats it.
   */
  textBackup: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AssetKind = 'model' | 'texture' | 'audio' | 'material' | 'prefab';

export interface ModelAssetInfo {
  meshes: number;
  materials: number;
  triangles: number;
  textures: number;
  animations: string[];
  /** Axis-aligned bounds of the model in its own space. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface TextureAssetInfo {
  width: number;
  height: number;
}

export interface AudioAssetInfo {
  durationSeconds: number | null;
}

export interface PrefabAssetInfo {
  objects: SceneObject[];
  roots: string[];
}

export interface AssetMeta {
  id: string;
  name: string;
  kind: AssetKind;
  /** Original file name (binary assets only). */
  fileName: string;
  mimeType: string;
  /** Size of the stored binary data in bytes (0 for data-only assets). */
  size: number;
  createdAt: string;
  model?: ModelAssetInfo;
  texture?: TextureAssetInfo;
  audio?: AudioAssetInfo;
  material?: MaterialComponent;
  prefab?: PrefabAssetInfo;
}

/** Asset kinds whose content lives in the binary asset store. */
export const BINARY_ASSET_KINDS: ReadonlySet<AssetKind> = new Set(['model', 'texture', 'audio']);

export interface ProjectBundle {
  manifest: ProjectManifest;
  scenes: Record<string, SceneData>;
  scripts: Record<string, ScriptDoc>;
  assets: Record<string, AssetMeta>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  template: ProjectTemplateId;
  createdAt: string;
  updatedAt: string;
  objectCount: number;
  thumbnail: string | null;
}

export function defaultProjectSettings(template: ProjectTemplateId = 'empty-baseplate'): ProjectSettings {
  return {
    player: {
      enabled: template !== 'empty-3d',
      moveSpeed: 8,
      jumpPower: 7,
      cameraMode: 'thirdPerson',
      color: '#ffb02e',
    },
    renderStyle: 'realistic',
    showScore: true,
  };
}
