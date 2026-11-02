import { isValidId } from '../core/ids';
import { isHexColor, isVec3, type Vec3 } from '../core/math';
import {
  createEmptySceneData,
  defaultBaseplate,
  defaultCollider,
  defaultEnvironment,
  defaultLight,
  defaultMaterial,
  defaultRigidBody,
} from '../scene/factory';
import type {
  BaseplateMaterialPreset,
  BodyType,
  ColliderShape,
  Components,
  EnvironmentSettings,
  MaterialComponent,
  MaterialStyle,
  ObjectType,
  SceneData,
  SceneObject,
} from '../scene/types';
import { SCENE_SCHEMA_VERSION } from '../scene/types';
import { migrateProject } from './migrations';
import {
  defaultProjectSettings,
  PROJECT_FORMAT_ID,
  PROJECT_SCHEMA_VERSION,
  type AssetKind,
  type AssetMeta,
  type ProjectBundle,
  type ProjectManifest,
  type ProjectSettings,
  type ProjectTemplateId,
  type ScriptDoc,
} from './types';

/**
 * Validation + normalisation of project data loaded from storage or files.
 *
 * Philosophy: hard errors only for data we cannot meaningfully recover
 * (not an object, wrong format id, unknown future schema, no scenes).
 * Everything else is repaired with safe defaults and reported as a warning
 * so users keep as much of their work as possible.
 */

export class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

export interface ValidationResult {
  bundle: ProjectBundle;
  warnings: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string): string => (isHexColor(v) ? v.toLowerCase() : fallback);
const vec = (v: unknown, fallback: Vec3): Vec3 => (isVec3(v) ? [v[0], v[1], v[2]] : [...fallback]);
function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}
const isoDate = (v: unknown, fallback: string): string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback;

const OBJECT_TYPES: readonly ObjectType[] = [
  'empty', 'cube', 'sphere', 'plane', 'cylinder', 'cone', 'directionalLight', 'pointLight',
  'spotLight', 'camera', 'baseplate', 'spawnPoint', 'model',
];
const MATERIAL_STYLES: readonly MaterialStyle[] = ['standard', 'toon', 'flat', 'unlit'];
const SURFACES: readonly BaseplateMaterialPreset[] = ['smooth', 'concrete', 'grass', 'sand', 'ice', 'custom'];
const COLLIDER_SHAPES: readonly ColliderShape[] = ['auto', 'box', 'sphere', 'capsule', 'cylinder'];
const BODY_TYPES: readonly BodyType[] = ['static', 'dynamic', 'kinematic'];
const TEMPLATES: readonly ProjectTemplateId[] = ['empty-baseplate', 'empty-3d', 'playground', 'example'];
const ASSET_KINDS: readonly AssetKind[] = ['model', 'texture', 'audio', 'material', 'prefab'];

export function normalizeMaterial(v: unknown): MaterialComponent {
  const d = defaultMaterial();
  if (!isObj(v)) return d;
  const repeat = Array.isArray(v.mapRepeat) && v.mapRepeat.length === 2 ? v.mapRepeat : [1, 1];
  return {
    style: oneOf(v.style, MATERIAL_STYLES, d.style),
    color: color(v.color, d.color),
    metalness: num(v.metalness, d.metalness, 0, 1),
    roughness: num(v.roughness, d.roughness, 0, 1),
    emissive: color(v.emissive, d.emissive),
    emissiveIntensity: num(v.emissiveIntensity, d.emissiveIntensity, 0, 100),
    opacity: num(v.opacity, d.opacity, 0, 1),
    mapAssetId: isValidId(v.mapAssetId) ? v.mapAssetId : null,
    mapRepeat: [num(repeat[0], 1, 0.01, 1000), num(repeat[1], 1, 0.01, 1000)],
    outline: bool(v.outline, d.outline),
    outlineColor: color(v.outlineColor, d.outlineColor),
    outlineWidth: num(v.outlineWidth, d.outlineWidth, 0, 1),
  };
}

function normalizeComponents(type: ObjectType, v: unknown): Components {
  const c: Components = {};
  const src = isObj(v) ? v : {};
  if (isObj(src.mesh)) {
    c.mesh = { castShadow: bool(src.mesh.castShadow, true), receiveShadow: bool(src.mesh.receiveShadow, true) };
  }
  if (src.material !== undefined) c.material = normalizeMaterial(src.material);
  if (isObj(src.light) || type === 'directionalLight' || type === 'pointLight' || type === 'spotLight') {
    const lightType = type === 'pointLight' || type === 'spotLight' ? type : 'directionalLight';
    const d = defaultLight(lightType);
    const l = isObj(src.light) ? src.light : {};
    c.light = {
      color: color(l.color, d.color),
      intensity: num(l.intensity, d.intensity, 0, 10000),
      castShadow: bool(l.castShadow, d.castShadow),
      range: num(l.range, d.range, 0, 100000),
      angle: num(l.angle, d.angle, 1, 89),
      penumbra: num(l.penumbra, d.penumbra, 0, 1),
    };
  }
  if (isObj(src.camera) || type === 'camera') {
    const cam = isObj(src.camera) ? src.camera : {};
    c.camera = {
      fov: num(cam.fov, 60, 10, 150),
      near: num(cam.near, 0.1, 0.001, 100),
      far: num(cam.far, 2000, 1, 100000),
      isMain: bool(cam.isMain, false),
    };
  }
  if (isObj(src.baseplate) || type === 'baseplate') {
    const d = defaultBaseplate();
    const b = isObj(src.baseplate) ? src.baseplate : {};
    c.baseplate = {
      width: num(b.width, d.width, 1, 8192),
      depth: num(b.depth, d.depth, 1, 8192),
      thickness: num(b.thickness, d.thickness, 0.1, 100),
      showGrid: bool(b.showGrid, d.showGrid),
      surface: oneOf(b.surface, SURFACES, d.surface),
    };
    if (!c.material) c.material = normalizeMaterial(undefined);
  }
  if (isObj(src.collider)) {
    const d = defaultCollider();
    c.collider = {
      enabled: bool(src.collider.enabled, d.enabled),
      shape: oneOf(src.collider.shape, COLLIDER_SHAPES, d.shape),
      isTrigger: bool(src.collider.isTrigger, d.isTrigger),
    };
  }
  if (isObj(src.rigidBody)) {
    const d = defaultRigidBody();
    const r = src.rigidBody;
    c.rigidBody = {
      type: oneOf(r.type, BODY_TYPES, d.type),
      mass: num(r.mass, d.mass, 0.001, 100000),
      friction: num(r.friction, d.friction, 0, 10),
      restitution: num(r.restitution, d.restitution, 0, 2),
      gravityScale: num(r.gravityScale, d.gravityScale, -10, 10),
      linearDamping: num(r.linearDamping, d.linearDamping, 0, 100),
      angularDamping: num(r.angularDamping, d.angularDamping, 0, 100),
    };
  }
  if (Array.isArray(src.scripts)) {
    c.scripts = src.scripts
      .filter((s): s is Obj => isObj(s) && isValidId(s.scriptId))
      .map((s) => ({ scriptId: s.scriptId as string, enabled: bool(s.enabled, true) }));
  }
  if (isObj(src.model) || type === 'model') {
    const m = isObj(src.model) ? src.model : {};
    c.model = {
      assetId: typeof m.assetId === 'string' ? m.assetId : '',
      animation: typeof m.animation === 'string' ? m.animation : null,
      loopAnimation: bool(m.loopAnimation, true),
    };
  }
  if (isObj(src.spawn) || type === 'spawnPoint') {
    const s = isObj(src.spawn) ? src.spawn : {};
    c.spawn = { showInGame: bool(s.showInGame, false) };
  }
  return c;
}

function normalizeObject(v: unknown, warnings: string[], where: string): SceneObject | null {
  if (!isObj(v)) {
    warnings.push(`${where}: removed an object that was not valid data`);
    return null;
  }
  if (!isValidId(v.id)) {
    warnings.push(`${where}: removed an object with an invalid id`);
    return null;
  }
  const type = oneOf(v.type, OBJECT_TYPES, 'empty');
  if (v.type !== type) warnings.push(`${where}: object "${String(v.name)}" had unknown type; converted to Empty`);
  const t = isObj(v.transform) ? v.transform : {};
  const name = str(v.name, '').trim().slice(0, 64) || 'Object';
  return {
    id: v.id,
    name,
    type,
    parentId: isValidId(v.parentId) ? v.parentId : null,
    transform: {
      position: vec(t.position, [0, 0, 0]),
      rotation: vec(t.rotation, [0, 0, 0]),
      scale: vec(t.scale, [1, 1, 1]),
    },
    visible: bool(v.visible, true),
    locked: bool(v.locked, false),
    components: normalizeComponents(type, v.components),
  };
}

function normalizeEnvironment(v: unknown): EnvironmentSettings {
  const d = defaultEnvironment();
  if (!isObj(v)) return d;
  const sky = isObj(v.sky) ? v.sky : {};
  const fog = isObj(v.fog) ? v.fog : {};
  return {
    background: oneOf(v.background, ['sky', 'color'] as const, d.background),
    backgroundColor: color(v.backgroundColor, d.backgroundColor),
    sky: {
      topColor: color(sky.topColor, d.sky.topColor),
      horizonColor: color(sky.horizonColor, d.sky.horizonColor),
      bottomColor: color(sky.bottomColor, d.sky.bottomColor),
    },
    ambientColor: color(v.ambientColor, d.ambientColor),
    ambientIntensity: num(v.ambientIntensity, d.ambientIntensity, 0, 20),
    environmentIntensity: num(v.environmentIntensity, d.environmentIntensity, 0, 10),
    fog: {
      enabled: bool(fog.enabled, d.fog.enabled),
      color: color(fog.color, d.fog.color),
      near: num(fog.near, d.fog.near, 0, 100000),
      far: num(fog.far, d.fog.far, 0.1, 100000),
    },
    gravity: num(v.gravity, d.gravity, -100, 100),
  };
}

export function normalizeScene(v: unknown, warnings: string[], fallbackId?: string): SceneData {
  if (!isObj(v)) throw new ProjectValidationError('Scene data is not an object');
  const id = isValidId(v.id) ? v.id : fallbackId;
  if (!id) throw new ProjectValidationError('Scene has no valid id');
  const scene = createEmptySceneData(str(v.name, 'Main Scene'), id);
  const where = `Scene "${scene.name}"`;
  const objects: SceneObject[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v.objects) ? v.objects : []) {
    const obj = normalizeObject(raw, warnings, where);
    if (!obj) continue;
    if (seen.has(obj.id)) {
      warnings.push(`${where}: removed duplicate object id ${obj.id}`);
      continue;
    }
    seen.add(obj.id);
    objects.push(obj);
  }
  // Repair parent links: missing parents and cycles become root objects.
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const o of objects) {
    if (o.parentId && !byId.has(o.parentId)) {
      warnings.push(`${where}: "${o.name}" referenced a missing parent and was moved to the top level`);
      o.parentId = null;
    }
  }
  for (const o of objects) {
    const visited = new Set<string>([o.id]);
    let p = o.parentId ? byId.get(o.parentId) : undefined;
    while (p) {
      if (visited.has(p.id)) {
        warnings.push(`${where}: fixed a parenting loop at "${o.name}"`);
        o.parentId = null;
        break;
      }
      visited.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
  }
  scene.objects = objects;
  scene.environment = normalizeEnvironment(v.environment);
  if (isObj(v.editorView) && isVec3(v.editorView.cameraPosition) && isVec3(v.editorView.cameraTarget)) {
    scene.editorView = {
      cameraPosition: [...v.editorView.cameraPosition] as Vec3,
      cameraTarget: [...v.editorView.cameraTarget] as Vec3,
    };
  }
  scene.schemaVersion = SCENE_SCHEMA_VERSION;
  return scene;
}

function normalizeSettings(v: unknown, template: ProjectTemplateId): ProjectSettings {
  const d = defaultProjectSettings(template);
  if (!isObj(v)) return d;
  const p = isObj(v.player) ? v.player : {};
  return {
    player: {
      enabled: bool(p.enabled, d.player.enabled),
      moveSpeed: num(p.moveSpeed, d.player.moveSpeed, 0.1, 100),
      jumpPower: num(p.jumpPower, d.player.jumpPower, 0, 100),
      cameraMode: oneOf(p.cameraMode, ['thirdPerson', 'firstPerson'] as const, d.player.cameraMode),
      color: color(p.color, d.player.color),
    },
    renderStyle: oneOf(v.renderStyle, ['realistic', 'stylized'] as const, d.renderStyle),
    showScore: bool(v.showScore, d.showScore),
  };
}

function normalizeScript(v: unknown, warnings: string[]): ScriptDoc | null {
  if (!isObj(v) || !isValidId(v.id)) {
    warnings.push('Removed a script with invalid data');
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: v.id,
    name: str(v.name, 'Script').slice(0, 64) || 'Script',
    mode: oneOf(v.mode, ['blocks', 'text'] as const, 'text'),
    source: str(v.source, ''),
    blocks: isObj(v.blocks) ? v.blocks : null,
    textBackup: typeof v.textBackup === 'string' ? v.textBackup : null,
    createdAt: isoDate(v.createdAt, now),
    updatedAt: isoDate(v.updatedAt, now),
  };
}

function normalizeAsset(v: unknown, warnings: string[]): AssetMeta | null {
  if (!isObj(v) || !isValidId(v.id)) {
    warnings.push('Removed an asset entry with invalid data');
    return null;
  }
  const kind = oneOf(v.kind, ASSET_KINDS, 'model');
  const asset: AssetMeta = {
    id: v.id,
    name: str(v.name, 'Asset').slice(0, 96) || 'Asset',
    kind,
    fileName: str(v.fileName, ''),
    mimeType: str(v.mimeType, 'application/octet-stream'),
    size: num(v.size, 0, 0),
    createdAt: isoDate(v.createdAt, new Date().toISOString()),
  };
  if (isObj(v.model)) {
    const m = v.model;
    asset.model = {
      meshes: num(m.meshes, 0, 0),
      materials: num(m.materials, 0, 0),
      triangles: num(m.triangles, 0, 0),
      textures: num(m.textures, 0, 0),
      animations: Array.isArray(m.animations) ? m.animations.filter((a): a is string => typeof a === 'string') : [],
      boundsMin: vec(m.boundsMin, [-0.5, -0.5, -0.5]),
      boundsMax: vec(m.boundsMax, [0.5, 0.5, 0.5]),
    };
  }
  if (isObj(v.texture)) asset.texture = { width: num(v.texture.width, 0, 0), height: num(v.texture.height, 0, 0) };
  if (isObj(v.audio)) {
    asset.audio = { durationSeconds: typeof v.audio.durationSeconds === 'number' ? v.audio.durationSeconds : null };
  }
  if (kind === 'material') asset.material = normalizeMaterial(v.material);
  if (kind === 'prefab') {
    const p = isObj(v.prefab) ? v.prefab : {};
    const objects = (Array.isArray(p.objects) ? p.objects : [])
      .map((o) => normalizeObject(o, warnings, `Prefab "${asset.name}"`))
      .filter((o): o is SceneObject => o !== null);
    const ids = new Set(objects.map((o) => o.id));
    const roots = (Array.isArray(p.roots) ? p.roots : []).filter((r): r is string => typeof r === 'string' && ids.has(r));
    asset.prefab = { objects, roots };
  }
  return asset;
}

export function validateManifest(v: unknown): ProjectManifest {
  if (!isObj(v)) throw new ProjectValidationError('Project file is not a JSON object');
  if (v.format !== PROJECT_FORMAT_ID) {
    throw new ProjectValidationError('This file is not a ZinoGame project (missing format id)');
  }
  const version = typeof v.schemaVersion === 'number' ? v.schemaVersion : NaN;
  if (!Number.isInteger(version)) throw new ProjectValidationError('Project has no schema version');
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectValidationError(
      `This project was made with a newer version of ZinoGame Studio (format v${version}). Please update the app.`,
    );
  }
  if (!isValidId(v.id)) throw new ProjectValidationError('Project has an invalid id');
  const template = oneOf(v.template, TEMPLATES, 'empty-baseplate');
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: v.id,
    name: str(v.name, 'Untitled Project').trim().slice(0, 64) || 'Untitled Project',
    description: str(v.description, '').slice(0, 500),
    template,
    createdAt: isoDate(v.createdAt, now),
    updatedAt: isoDate(v.updatedAt, now),
    appVersion: str(v.appVersion, '0.0.0'),
    mainSceneId: isValidId(v.mainSceneId) ? v.mainSceneId : '',
    sceneIds: Array.isArray(v.sceneIds) ? v.sceneIds.filter(isValidId) : [],
    settings: normalizeSettings(v.settings, template),
  };
}

/**
 * Validates, migrates and normalises an unknown value into a ProjectBundle.
 * Throws ProjectValidationError for unrecoverable data.
 */
export function validateProjectBundle(input: unknown): ValidationResult {
  const warnings: string[] = [];
  if (!isObj(input)) throw new ProjectValidationError('Project data is missing or corrupt');
  const migrated = migrateProject(input, warnings);
  const manifest = validateManifest(migrated.manifest);

  const rawScenes = isObj(migrated.scenes) ? migrated.scenes : {};
  const scenes: Record<string, SceneData> = {};
  for (const [key, raw] of Object.entries(rawScenes)) {
    try {
      const scene = normalizeScene(raw, warnings, isValidId(key) ? key : undefined);
      scenes[scene.id] = scene;
    } catch (err) {
      warnings.push(`Removed an unreadable scene: ${(err as Error).message}`);
    }
  }
  const sceneIdList = Object.keys(scenes);
  if (sceneIdList.length === 0) throw new ProjectValidationError('Project contains no readable scenes');
  manifest.sceneIds = [
    ...manifest.sceneIds.filter((id) => scenes[id]),
    ...sceneIdList.filter((id) => !manifest.sceneIds.includes(id)),
  ];
  if (!scenes[manifest.mainSceneId]) {
    if (manifest.mainSceneId) warnings.push('Main scene was missing; using the first available scene');
    manifest.mainSceneId = manifest.sceneIds[0] as string;
  }

  const scripts: Record<string, ScriptDoc> = {};
  for (const raw of Object.values(isObj(migrated.scripts) ? migrated.scripts : {})) {
    const s = normalizeScript(raw, warnings);
    if (s) scripts[s.id] = s;
  }
  const assets: Record<string, AssetMeta> = {};
  for (const raw of Object.values(isObj(migrated.assets) ? migrated.assets : {})) {
    const a = normalizeAsset(raw, warnings);
    if (a) assets[a.id] = a;
  }
  return { bundle: { manifest, scenes, scripts, assets }, warnings };
}

const PROJECT_NAME_MAX = 64;

/** Validates a user-entered project name. Returns an error message or null. */
export function projectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Please give your project a name.';
  if (trimmed.length > PROJECT_NAME_MAX) return `Names can be up to ${PROJECT_NAME_MAX} characters.`;
  // Characters that are invalid in file names on common platforms (used on export).
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(trimmed)) {
    return 'Names cannot contain these characters: < > : " / \\ | ? *';
  }
  return null;
}

export { SCENE_SCHEMA_VERSION };
