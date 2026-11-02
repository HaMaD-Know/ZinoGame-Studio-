import { Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type Camera } from 'three';

/**
 * Adaptive editor grid.
 *
 * This is an editor-only overlay, completely independent from the baseplate
 * surface material: the baseplate is a plain grey mesh, and the grid is a
 * separate transparent plane drawn on top of it. Cell size adapts to the
 * camera distance (1 → 10 → 100 units...) and lines fade smoothly between
 * levels and towards the horizon, so the grid stays readable at any zoom.
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform float uScale;
  uniform float uFade;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform vec3 uCamPos;
  uniform float uFadeDistance;
  uniform float uOpacity;
  uniform vec2 uLocalScale;
  uniform float uWorldSpace;
  varying vec3 vWorld;
  varying vec2 vLocal;

  float gridLine(vec2 coord, float size) {
    vec2 c = coord / size;
    vec2 d = fwidth(c);
    vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-4));
    float line = min(g.x, g.y);
    return 1.0 - min(line, 1.0);
  }

  void main() {
    vec2 p = uWorldSpace > 0.5 ? vWorld.xz : vLocal * uLocalScale;
    float minor = gridLine(p, uScale) * (1.0 - uFade);
    float major = gridLine(p, uScale * 10.0);
    float alpha = max(minor * 0.32, major * 0.6);
    float dist = length(vWorld - uCamPos);
    alpha *= 1.0 - smoothstep(uFadeDistance * 0.35, uFadeDistance, dist);
    alpha *= uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uMinorColor, uMajorColor, step(0.5, major)), alpha);
  }`;

export class AdaptiveGrid extends Mesh<PlaneGeometry, ShaderMaterial> {
  private readonly tmp = new Vector3();

  constructor() {
    super(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        uniforms: {
          uScale: { value: 1 },
          uFade: { value: 0 },
          uMinorColor: { value: new Color('#ffffff') },
          uMajorColor: { value: new Color('#ffffff') },
          uCamPos: { value: new Vector3() },
          uFadeDistance: { value: 400 },
          uOpacity: { value: 1 },
          uLocalScale: { value: [1, 1] },
          uWorldSpace: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: false,
      }),
    );
    this.rotation.x = -Math.PI / 2;
    this.renderOrder = 10;
    this.name = 'ZinoEditorGrid';
    this.userData.editorHelper = true;
    this.frustumCulled = false;
    this.setColors('#1d2433', '#0d1220');
  }

  setColors(minor: string, major: string): void {
    this.material.uniforms.uMinorColor!.value.set(minor);
    this.material.uniforms.uMajorColor!.value.set(major);
  }

  /** Sizes the grid (in world units). The grid keeps 1-unit cells regardless of size. */
  setSize(width: number, depth: number): void {
    this.scale.set(width, depth, 1);
    this.material.uniforms.uLocalScale!.value = [width, depth];
  }

  /** World-space grids stay aligned to world units while the mesh follows the camera. */
  setWorldSpace(enabled: boolean): void {
    this.material.uniforms.uWorldSpace!.value = enabled ? 1 : 0;
  }

  /** Updates cell size and fading for the current camera. */
  update(camera: Camera, focusDistance: number): void {
    const d = Math.max(focusDistance, 1);
    const level = Math.log10(d / 6);
    const n = Math.floor(level);
    this.material.uniforms.uScale!.value = Math.pow(10, Math.max(n, -1));
    this.material.uniforms.uFade!.value = level - n;
    camera.getWorldPosition(this.tmp);
    this.material.uniforms.uCamPos!.value.copy(this.tmp);
    this.material.uniforms.uFadeDistance!.value = Math.max(80, d * 12);
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
