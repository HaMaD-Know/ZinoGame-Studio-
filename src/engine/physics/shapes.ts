import type { Vec3 } from '../core/math';
import type { AssetMeta } from '../project/types';
import type { SceneObject } from '../scene/types';

/**
 * Derives physics collider shapes from scene objects. Visible meshes do NOT
 * automatically get colliders: an object needs an enabled collider
 * component. Shapes are computed in the object's local frame with its scale
 * baked in (physics engines do not support scaled shapes).
 */

export type ColliderShapeDesc =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3 }
  | { kind: 'ball'; radius: number; offset: Vec3 }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'cylinder'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'cone'; halfHeight: number; radius: number; offset: Vec3 };

const MIN = 0.005;

function abs3(v: Vec3): Vec3 {
  return [Math.max(MIN, Math.abs(v[0])), Math.max(MIN, Math.abs(v[1])), Math.max(MIN, Math.abs(v[2]))];
}

/** The natural shape for an object type (used when the collider shape is "auto"). */
function autoShape(obj: SceneObject, assets: Record<string, AssetMeta>): ColliderShapeDesc | null {
  const s = abs3(obj.transform.scale);
  const zero: Vec3 = [0, 0, 0];
  switch (obj.type) {
    case 'cube':
      return { kind: 'box', halfExtents: [s[0] / 2, s[1] / 2, s[2] / 2], offset: zero };
    case 'sphere':
      return { kind: 'ball', radius: Math.max(s[0], s[1], s[2]) / 2, offset: zero };
    case 'cylinder':
      return { kind: 'cylinder', halfHeight: s[1] / 2, radius: Math.max(s[0], s[2]) / 2, offset: zero };
    case 'cone':
      return { kind: 'cone', halfHeight: s[1] / 2, radius: Math.max(s[0], s[2]) / 2, offset: zero };
    case 'plane':
      return { kind: 'box', halfExtents: [s[0] / 2, 0.01, s[2] / 2], offset: zero };
    case 'baseplate': {
      const bp = obj.components.baseplate;
      if (!bp) return null;
      const t = bp.thickness * s[1];
      return { kind: 'box', halfExtents: [(bp.width * s[0]) / 2, t / 2, (bp.depth * s[2]) / 2], offset: [0, -t / 2, 0] };
    }
    case 'model': {
      const info = assets[obj.components.model?.assetId ?? '']?.model;
      const min = info?.boundsMin ?? [-0.5, -0.5, -0.5];
      const max = info?.boundsMax ?? [0.5, 0.5, 0.5];
      return {
        kind: 'box',
        halfExtents: [
          Math.max(MIN, ((max[0] - min[0]) * s[0]) / 2),
          Math.max(MIN, ((max[1] - min[1]) * s[1]) / 2),
          Math.max(MIN, ((max[2] - min[2]) * s[2]) / 2),
        ],
        offset: [((max[0] + min[0]) / 2) * s[0], ((max[1] + min[1]) / 2) * s[1], ((max[2] + min[2]) / 2) * s[2]],
      };
    }
    default:
      return null;
  }
}

function halfExtentsOf(shape: ColliderShapeDesc): Vec3 {
  switch (shape.kind) {
    case 'box':
      return shape.halfExtents;
    case 'ball':
      return [shape.radius, shape.radius, shape.radius];
    case 'capsule':
      return [shape.radius, shape.halfHeight + shape.radius, shape.radius];
    case 'cylinder':
    case 'cone':
      return [shape.radius, shape.halfHeight, shape.radius];
  }
}

export function colliderShapeFor(obj: SceneObject, assets: Record<string, AssetMeta> = {}): ColliderShapeDesc | null {
  const collider = obj.components.collider;
  if (!collider?.enabled) return null;
  const auto = autoShape(obj, assets);
  if (!auto) return null;
  if (collider.shape === 'auto') return auto;
  const [hx, hy, hz] = halfExtentsOf(auto);
  const offset = auto.offset;
  switch (collider.shape) {
    case 'box':
      return { kind: 'box', halfExtents: [hx, hy, hz], offset };
    case 'sphere':
      return { kind: 'ball', radius: Math.max(hx, hy, hz), offset };
    case 'capsule': {
      const radius = Math.max(MIN, Math.max(hx, hz));
      return { kind: 'capsule', radius, halfHeight: Math.max(0, hy - radius), offset };
    }
    case 'cylinder':
      return { kind: 'cylinder', halfHeight: hy, radius: Math.max(hx, hz), offset };
  }
}

/** Approximate volume, used to derive density from the user-facing mass. */
export function shapeVolume(shape: ColliderShapeDesc): number {
  switch (shape.kind) {
    case 'box':
      return 8 * shape.halfExtents[0] * shape.halfExtents[1] * shape.halfExtents[2];
    case 'ball':
      return (4 / 3) * Math.PI * shape.radius ** 3;
    case 'capsule':
      return Math.PI * shape.radius ** 2 * (2 * shape.halfHeight) + (4 / 3) * Math.PI * shape.radius ** 3;
    case 'cylinder':
      return Math.PI * shape.radius ** 2 * 2 * shape.halfHeight;
    case 'cone':
      return (Math.PI * shape.radius ** 2 * 2 * shape.halfHeight) / 3;
  }
}
