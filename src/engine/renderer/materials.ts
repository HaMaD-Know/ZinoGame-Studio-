import {
  BackSide,
  Color,
  DataTexture,
  FrontSide,
  Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  type Texture,
} from 'three';
import type { MaterialComponent } from '../scene/types';

/**
 * Material factory: converts the serialisable MaterialComponent into Three.js
 * materials for each visual style. Realistic = PBR (MeshStandardMaterial);
 * stylised = toon / flat / unlit.
 */

export type RenderMaterial = MeshStandardMaterial | MeshToonMaterial | MeshLambertMaterial | MeshBasicMaterial;

let toonGradient: DataTexture | null = null;

/** Three-band gradient used by toon shading. */
export function getToonGradient(): DataTexture {
  if (!toonGradient) {
    toonGradient = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
    toonGradient.minFilter = NearestFilter;
    toonGradient.magFilter = NearestFilter;
    toonGradient.generateMipmaps = false;
    toonGradient.needsUpdate = true;
  }
  return toonGradient;
}

function classFor(style: MaterialComponent['style']) {
  switch (style) {
    case 'toon':
      return MeshToonMaterial;
    case 'flat':
      return MeshLambertMaterial;
    case 'unlit':
      return MeshBasicMaterial;
    default:
      return MeshStandardMaterial;
  }
}

export function createMaterial(spec: MaterialComponent): RenderMaterial {
  const Cls = classFor(spec.style);
  const material = new Cls();
  applyMaterial(material, spec);
  return material;
}

/** True if the existing material instance can represent the spec (same style). */
export function materialMatchesStyle(material: Material, spec: MaterialComponent): boolean {
  return material instanceof classFor(spec.style) && material.constructor === classFor(spec.style);
}

export function applyMaterial(material: RenderMaterial, spec: MaterialComponent, map: Texture | null = null): void {
  material.color = new Color(spec.color);
  material.opacity = spec.opacity;
  material.transparent = spec.opacity < 1;
  material.depthWrite = spec.opacity >= 0.999;
  material.side = FrontSide;
  if (material instanceof MeshStandardMaterial) {
    material.metalness = spec.metalness;
    material.roughness = spec.roughness;
  }
  if (!(material instanceof MeshBasicMaterial)) {
    material.emissive = new Color(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity;
  }
  if (material instanceof MeshToonMaterial) material.gradientMap = getToonGradient();
  if (material instanceof MeshLambertMaterial) material.flatShading = spec.style === 'flat';
  if (map) {
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.repeat.set(spec.mapRepeat[0], spec.mapRepeat[1]);
  }
  if (material.map !== map) material.map = map;
  material.needsUpdate = true;
}

/**
 * Outline (inverted hull) material for stylised looks. Vertices are pushed
 * along their normals in the vertex shader, so the hull stays a constant
 * thickness regardless of object scale.
 */
export function createOutlineMaterial(color: string, width: number): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: new Color(color), side: BackSide });
  material.userData.outlineWidth = { value: width };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = material.userData.outlineWidth as { value: number };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineWidth;');
  };
  material.customProgramCacheKey = () => 'zino-outline';
  return material;
}

export function updateOutlineMaterial(material: MeshBasicMaterial, color: string, width: number): void {
  material.color.set(color);
  (material.userData.outlineWidth as { value: number }).value = width;
}
