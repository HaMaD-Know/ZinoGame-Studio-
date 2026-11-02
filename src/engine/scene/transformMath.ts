import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { DEG2RAD, RAD2DEG, roundVec3, type Vec3 } from '../core/math';
import type { SceneData, SceneObject, Transform } from './types';

const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _euler = new Euler();

export function transformToMatrix(t: Transform, target = new Matrix4()): Matrix4 {
  _euler.set(t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD, 'XYZ');
  _quat.setFromEuler(_euler);
  _pos.set(...t.position);
  _scale.set(...t.scale);
  return target.compose(_pos, _quat, _scale);
}

export function matrixToTransform(m: Matrix4): Transform {
  m.decompose(_pos, _quat, _scale);
  _euler.setFromQuaternion(_quat, 'XYZ');
  return {
    position: roundVec3([_pos.x, _pos.y, _pos.z]),
    rotation: roundVec3([_euler.x * RAD2DEG, _euler.y * RAD2DEG, _euler.z * RAD2DEG]),
    scale: roundVec3([_scale.x, _scale.y, _scale.z]),
  };
}

/** World matrix of an object, walking up its parent chain. */
export function worldMatrixOf(scene: SceneData, id: string, byId?: Map<string, SceneObject>): Matrix4 {
  const lookup = byId ?? new Map(scene.objects.map((o) => [o.id, o]));
  const chain: SceneObject[] = [];
  let current = lookup.get(id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    chain.unshift(current);
    current = current.parentId ? lookup.get(current.parentId) : undefined;
  }
  const result = new Matrix4();
  const local = new Matrix4();
  for (const obj of chain) {
    transformToMatrix(obj.transform, local);
    result.multiply(local);
  }
  return result;
}

export function worldPositionOf(scene: SceneData, id: string): Vec3 {
  const m = worldMatrixOf(scene, id);
  const p = new Vector3().setFromMatrixPosition(m);
  return [p.x, p.y, p.z];
}

/**
 * Computes the local transform an object needs under `newParentId` so that
 * its world transform stays the same.
 */
export function localTransformForParent(
  scene: SceneData,
  objectId: string,
  newParentId: string | null,
): Transform {
  const world = worldMatrixOf(scene, objectId);
  if (!newParentId) return matrixToTransform(world);
  const parentWorld = worldMatrixOf(scene, newParentId);
  const inv = parentWorld.clone().invert();
  return matrixToTransform(inv.multiply(world));
}
