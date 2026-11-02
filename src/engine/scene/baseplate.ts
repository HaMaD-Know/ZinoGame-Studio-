import { clamp, isHexColor } from '../core/math';
import {
  BASEPLATE_DEFAULT_COLOR,
  BASEPLATE_MAX_SIZE,
  BASEPLATE_MIN_SIZE,
  BASEPLATE_SURFACES,
  createBaseplate,
  defaultBaseplate,
  defaultCollider,
} from './factory';
import { updateObject } from './sceneOps';
import type { BaseplateComponent, BaseplateMaterialPreset, SceneData, SceneObject } from './types';

/** Baseplate-specific editing operations. All are pure and undoable. */

function requireBaseplate(obj: SceneObject): BaseplateComponent {
  if (obj.type !== 'baseplate' || !obj.components.baseplate) {
    throw new Error(`Object ${obj.id} is not a baseplate`);
  }
  return obj.components.baseplate;
}

export function clampBaseplateSize(value: number): number {
  if (!Number.isFinite(value)) return BASEPLATE_MIN_SIZE;
  return clamp(Math.round(value * 100) / 100, BASEPLATE_MIN_SIZE, BASEPLATE_MAX_SIZE);
}

export function updateBaseplate(
  scene: SceneData,
  id: string,
  patch: Partial<BaseplateComponent>,
): SceneData {
  return updateObject(scene, id, (o) => {
    const bp = requireBaseplate(o);
    const next: BaseplateComponent = { ...bp, ...patch };
    next.width = clampBaseplateSize(next.width);
    next.depth = clampBaseplateSize(next.depth);
    next.thickness = clamp(Number.isFinite(next.thickness) ? next.thickness : 4, 0.1, 100);
    return { ...o, components: { ...o.components, baseplate: next } };
  });
}

export function resizeBaseplate(scene: SceneData, id: string, width: number, depth: number): SceneData {
  return updateBaseplate(scene, id, { width, depth });
}

export function setBaseplateColor(scene: SceneData, id: string, color: string): SceneData {
  if (!isHexColor(color)) throw new Error(`Invalid colour: ${color}`);
  return updateObject(scene, id, (o) => {
    requireBaseplate(o);
    const material = o.components.material;
    if (!material) return o;
    const baseplate = o.components.baseplate as BaseplateComponent;
    return {
      ...o,
      components: {
        ...o.components,
        material: { ...material, color },
        baseplate: { ...baseplate, surface: 'custom' },
      },
    };
  });
}

export function setBaseplateSurface(
  scene: SceneData,
  id: string,
  surface: BaseplateMaterialPreset,
): SceneData {
  const preset = BASEPLATE_SURFACES[surface];
  return updateObject(scene, id, (o) => {
    const bp = requireBaseplate(o);
    const material = o.components.material;
    if (!material) return o;
    return {
      ...o,
      components: {
        ...o.components,
        baseplate: { ...bp, surface },
        material:
          surface === 'custom'
            ? material
            : { ...material, color: preset.color, roughness: preset.roughness, metalness: preset.metalness },
      },
    };
  });
}

export function setBaseplateGrid(scene: SceneData, id: string, showGrid: boolean): SceneData {
  return updateBaseplate(scene, id, { showGrid });
}

export function setBaseplateCollision(scene: SceneData, id: string, enabled: boolean): SceneData {
  return updateObject(scene, id, (o) => {
    requireBaseplate(o);
    const collider = o.components.collider ?? defaultCollider();
    return { ...o, components: { ...o.components, collider: { ...collider, enabled } } };
  });
}

/** Restores default size, surface, colour, grid, collision and transform. Keeps id and name. */
export function resetBaseplate(scene: SceneData, id: string): SceneData {
  return updateObject(scene, id, (o) => {
    requireBaseplate(o);
    const fresh = createBaseplate({ id: o.id, name: o.name, parentId: o.parentId });
    return {
      ...fresh,
      components: { ...o.components, ...fresh.components, scripts: o.components.scripts },
    };
  });
}

export function baseplateDefaults(): { component: BaseplateComponent; color: string } {
  return { component: defaultBaseplate(), color: BASEPLATE_DEFAULT_COLOR };
}
