import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PrimitiveType } from '../scene/types';

/**
 * Shared unit-size primitive geometries. Objects are sized with their
 * transform scale, so all cubes share one geometry (saves GPU memory).
 */

const cache = new Map<string, BufferGeometry>();
const outlineCache = new WeakMap<BufferGeometry, BufferGeometry>();

export function primitiveGeometry(type: PrimitiveType): BufferGeometry {
  let g = cache.get(type);
  if (!g) {
    switch (type) {
      case 'cube':
        g = new BoxGeometry(1, 1, 1);
        break;
      case 'sphere':
        g = new SphereGeometry(0.5, 32, 20);
        break;
      case 'plane':
        g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        break;
      case 'cylinder':
        g = new CylinderGeometry(0.5, 0.5, 1, 32);
        break;
      case 'cone':
        g = new ConeGeometry(0.5, 1, 32);
        break;
    }
    g.userData.shared = true;
    cache.set(type, g);
  }
  return g;
}

/** Geometry with smoothed normals for gap-free outlines on hard-edged shapes. */
export function outlineGeometry(source: BufferGeometry): BufferGeometry {
  let g = outlineCache.get(source);
  if (!g) {
    const stripped = source.clone();
    for (const name of Object.keys(stripped.attributes)) if (name !== 'position') stripped.deleteAttribute(name);
    g = mergeVertices(stripped, 1e-4);
    g.computeVertexNormals();
    g.userData.shared = source.userData.shared === true;
    stripped.dispose();
    outlineCache.set(source, g);
  }
  return g;
}

export function isSharedGeometry(g: BufferGeometry): boolean {
  return g.userData.shared === true;
}
