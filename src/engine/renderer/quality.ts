export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  label: string;
  description: string;
  /** Upper bound for the device pixel ratio (limits GPU memory on Retina iPads). */
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-size of the area covered by the sun's shadow map, in world units. */
  shadowDistance: number;
  /** Image-based lighting for PBR materials. */
  environmentLighting: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    description: 'Fastest. No shadows, lower resolution. Best for older devices and long battery life.',
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    shadowDistance: 30,
    environmentLighting: false,
  },
  medium: {
    label: 'Medium',
    description: 'Balanced. Soft shadows and reflections at a sensible resolution. Recommended for iPad.',
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowDistance: 45,
    environmentLighting: true,
  },
  high: {
    label: 'High',
    description: 'Sharpest picture with detailed shadows. Uses more battery and memory.',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 70,
    environmentLighting: true,
  },
};

export function pixelRatioFor(level: QualityLevel, devicePixelRatio = globalThis.devicePixelRatio || 1): number {
  return Math.max(0.5, Math.min(devicePixelRatio, QUALITY_PRESETS[level].maxPixelRatio));
}

export interface GraphicsCapabilities {
  webgl2: boolean;
  webgpu: boolean;
  maxTextureSize: number | null;
  renderer: string | null;
}

/** Detects GPU features without creating a long-lived context. */
export function detectGraphicsCapabilities(): GraphicsCapabilities {
  const result: GraphicsCapabilities = { webgl2: false, webgpu: false, maxTextureSize: null, renderer: null };
  try {
    result.webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
    if (typeof document === 'undefined') return result;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      result.webgl2 = true;
      result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      result.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Capability detection must never break the app.
  }
  return result;
}
