import { Color, Fog, HemisphereLight, type Scene, type Texture } from 'three';
import type { EnvironmentSettings } from '../scene/types';
import { GradientSky } from './sky';

/** Applies sky, background, fog, ambient and image-based lighting to a Three.js scene. */
export class SceneEnvironment {
  readonly sky = new GradientSky();
  readonly ambient = new HemisphereLight('#bcd4ff', '#8a9bb0', 0.6);
  private current: EnvironmentSettings | null = null;

  constructor(private readonly scene: Scene) {
    this.ambient.name = 'ZinoAmbient';
    scene.add(this.sky, this.ambient);
  }

  apply(env: EnvironmentSettings, ibl: Texture | null): void {
    const scene = this.scene;
    if (this.current !== env) {
      this.current = env;
      this.sky.setColors(env.sky);
      this.sky.visible = env.background === 'sky';
      scene.background = env.background === 'color' ? new Color(env.backgroundColor) : null;
      this.ambient.color.set(env.ambientColor);
      this.ambient.groundColor.set(env.sky.bottomColor);
      this.ambient.intensity = env.ambientIntensity;
      if (env.fog.enabled) {
        if (scene.fog instanceof Fog) {
          scene.fog.color.set(env.fog.color);
          scene.fog.near = env.fog.near;
          scene.fog.far = Math.max(env.fog.near + 0.1, env.fog.far);
        } else {
          scene.fog = new Fog(env.fog.color, env.fog.near, Math.max(env.fog.near + 0.1, env.fog.far));
        }
      } else {
        scene.fog = null;
      }
    }
    scene.environment = ibl;
    scene.environmentIntensity = env.environmentIntensity;
  }

  dispose(): void {
    this.sky.removeFromParent();
    this.sky.dispose();
    this.ambient.removeFromParent();
    this.ambient.dispose();
  }
}
