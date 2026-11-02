import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { SkySettings } from '../scene/types';

/** A cheap three-colour gradient sky dome (no textures, works on every GPU). */
export class GradientSky extends Mesh<SphereGeometry, ShaderMaterial> {
  constructor(radius = 4000) {
    super(
      new SphereGeometry(radius, 32, 16),
      new ShaderMaterial({
        uniforms: {
          topColor: { value: new Color('#4a8fe7') },
          horizonColor: { value: new Color('#cfe6ff') },
          bottomColor: { value: new Color('#8a9bb0') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 bottomColor;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 col = h > 0.0
              ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
              : mix(horizonColor, bottomColor, pow(clamp(-h, 0.0, 1.0), 0.4));
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.name = 'ZinoSky';
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.userData.editorHelper = true;
  }

  setColors(sky: SkySettings): void {
    this.material.uniforms.topColor!.value.set(sky.topColor);
    this.material.uniforms.horizonColor!.value.set(sky.horizonColor);
    this.material.uniforms.bottomColor!.value.set(sky.bottomColor);
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
