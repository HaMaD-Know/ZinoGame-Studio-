import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PCFSoftShadowMap,
  PMREMGenerator,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { pixelRatioFor, QUALITY_PRESETS, type QualityLevel } from './quality';

/**
 * Owns the WebGL renderer and canvas. Shared by the editor viewport and the
 * game runtime (play mode renders into the same canvas), so there is only
 * ever one GPU context — important on memory-constrained iPads.
 */

export class RendererInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererInitError';
  }
}

export interface RenderContextEvents {
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onResize?: (width: number, height: number) => void;
}

export class RenderContext {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly antialias: boolean;
  private qualityLevel: QualityLevel;
  private environment: Texture | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private width = 1;
  private height = 1;
  private lost = false;

  constructor(
    private readonly container: HTMLElement,
    quality: QualityLevel,
    private readonly events: RenderContextEvents = {},
  ) {
    this.qualityLevel = quality;
    this.antialias = QUALITY_PRESETS[quality].antialias;
    const canvas = document.createElement('canvas');
    canvas.className = 'zino-viewport-canvas';
    canvas.setAttribute('aria-label', '3D viewport');
    canvas.setAttribute('role', 'img');
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: this.antialias,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (err) {
      throw new RendererInitError(
        `3D graphics (WebGL) could not start on this device: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    this.renderer = renderer;
    this.canvas = canvas;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    container.appendChild(canvas);
    this.applyQuality();

    canvas.addEventListener('webglcontextlost', this.handleLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleRestored, false);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get quality(): QualityLevel {
    return this.qualityLevel;
  }

  get isContextLost(): boolean {
    return this.lost;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Applies a quality level. Returns true when the change needs a new
   * context (antialiasing can only be chosen when the context is created).
   */
  setQuality(level: QualityLevel): boolean {
    this.qualityLevel = level;
    this.applyQuality();
    return QUALITY_PRESETS[level].antialias !== this.antialias;
  }

  private applyQuality(): void {
    const preset = QUALITY_PRESETS[this.qualityLevel];
    this.renderer.setPixelRatio(pixelRatioFor(this.qualityLevel));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = this.qualityLevel === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize(true);
  }

  resize(force = false): boolean {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (!force && w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, true);
    this.events.onResize?.(w, h);
    return true;
  }

  /** Image-based lighting texture (lazily generated, shared). Null on Low quality. */
  getEnvironment(): Texture | null {
    if (!QUALITY_PRESETS[this.qualityLevel].environmentLighting) return null;
    if (!this.environment) {
      const pmrem = new PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    }
    return this.environment;
  }

  /** Small JPEG of the current frame (for project thumbnails). */
  captureThumbnail(render: () => void, maxSize = 320): string | null {
    try {
      render();
      const src = this.canvas;
      const scale = Math.min(1, maxSize / Math.max(src.width, src.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(src.width * scale));
      out.height = Math.max(1, Math.round(src.height * scale));
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  private handleLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.events.onContextLost?.();
  };

  private handleRestored = () => {
    this.lost = false;
    this.environment = null;
    this.events.onContextRestored?.();
  };

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    this.environment?.dispose();
    this.environment = null;
    this.renderer.dispose();
    this.canvas.remove();
  }
}
