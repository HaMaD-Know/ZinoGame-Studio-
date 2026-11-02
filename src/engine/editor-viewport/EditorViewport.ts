import {
  Box3,
  BoxHelper,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  PerspectiveCamera,
  BoxGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WireframeGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AssetCache } from '../assets/AssetCache';
import { RAD2DEG, roundVec3, type Vec3 } from '../core/math';
import { colliderShapeFor, type ColliderShapeDesc } from '../physics/shapes';
import type { AssetMeta } from '../project/types';
import type { SceneData, Transform } from '../scene/types';
import { AdaptiveGrid } from '../renderer/grid';
import { QUALITY_PRESETS, type QualityLevel } from '../renderer/quality';
import { RenderContext } from '../renderer/RenderContext';
import { SceneEnvironment } from '../renderer/SceneEnvironment';
import { SceneSync } from '../renderer/SceneSync';

/**
 * The editor's 3D viewport. Framework-agnostic: React mounts it into a div
 * and talks to it through this small API. It renders on demand (only when
 * something changed) to save battery on tablets.
 */

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale';

export interface TransformChange {
  id: string;
  before: Transform;
  after: Transform;
}

export interface ViewportCallbacks {
  onPick?: (id: string | null, additive: boolean) => void;
  onTransformPreview?: (changes: TransformChange[]) => void;
  onTransformCommit?: (changes: TransformChange[]) => void;
  onCameraChange?: (position: Vec3, target: Vec3) => void;
  onAssetError?: (objectName: string, message: string) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface SnapSettings {
  translate: number | null;
  rotate: number | null;
  scale: number | null;
}

const SELECT_COLOR = '#ff9f1c';
const COLLIDER_COLOR = '#3ddc84';
const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 600;

export class EditorViewport {
  readonly context: RenderContext;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  readonly sync: SceneSync;
  private readonly environment: SceneEnvironment;
  private readonly overlay = new Group();
  private readonly gridGroup = new Group();
  private readonly infiniteGrid = new AdaptiveGrid();
  private readonly baseplateGrids = new Map<string, AdaptiveGrid>();
  private readonly selectionHelpers = new Map<string, BoxHelper>();
  private readonly colliderHelpers: LineSegments[] = [];
  private readonly raycaster = new Raycaster();
  private sceneData: SceneData | null = null;
  private assets: Record<string, AssetMeta> = {};
  private selection: string[] = [];
  private mode: GizmoMode = 'translate';
  private showGrid = true;
  private showColliders = false;
  private renderQueued = false;
  private disposed = false;
  private paused = false;
  private pointerDown: { x: number; y: number; t: number; id: number } | null = null;
  private dragStart = new Map<string, { transform: Transform; world: Vector3 }>();
  private cameraTween: { from: Vector3; to: Vector3; fromTarget: Vector3; toTarget: Vector3; t0: number; duration: number } | null = null;
  private cameraChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private frameHandle = 0;

  constructor(
    container: HTMLElement,
    assetCache: AssetCache,
    quality: QualityLevel,
    private readonly callbacks: ViewportCallbacks = {},
  ) {
    this.context = new RenderContext(container, quality, {
      onResize: (w, h) => {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.invalidate();
      },
      onContextLost: () => callbacks.onContextLost?.(),
      onContextRestored: () => {
        callbacks.onContextRestored?.();
        this.invalidate();
      },
    });
    const canvas = this.context.canvas;
    canvas.style.touchAction = 'none';

    this.sync = new SceneSync({
      mode: 'editor',
      assets: assetCache,
      onAsyncChange: () => this.invalidate(),
      onAssetError: (name, msg) => callbacks.onAssetError?.(name, msg),
    });
    this.environment = new SceneEnvironment(this.scene);
    this.scene.add(this.sync.root, this.sync.lightRig, this.gridGroup, this.overlay);
    this.gridGroup.add(this.infiniteGrid);
    this.infiniteGrid.setWorldSpace(true);
    this.infiniteGrid.setSize(4000, 4000);

    this.camera.position.set(18, 14, 26);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.maxDistance = 3000;
    this.orbit.minDistance = 0.5;
    this.orbit.target.set(0, 0, 0);
    this.orbit.addEventListener('change', () => {
      this.invalidate();
      this.scheduleCameraChange();
    });

    this.gizmo = new TransformControls(this.camera, canvas);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.gizmo.setSize(coarse ? 1.35 : 1);
    this.gizmo.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.orbit.enabled = !dragging;
      if (dragging) this.beginDrag();
      else this.endDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this.previewDrag());
    this.gizmo.addEventListener('change', () => this.invalidate());
    const gizmoHelper = this.gizmo.getHelper();
    gizmoHelper.userData.editorHelper = true;
    this.scene.add(gizmoHelper);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    this.invalidate();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  setScene(scene: SceneData, assets: Record<string, AssetMeta>): void {
    const first = this.sceneData === null || this.sceneData.id !== scene.id;
    this.sceneData = scene;
    this.assets = assets;
    this.sync.sync(scene);
    this.environment.apply(scene.environment, this.context.getEnvironment());
    this.updateGrids();
    this.refreshSelectionHelpers();
    this.reattachGizmo();
    if (first && scene.editorView) {
      this.camera.position.set(...scene.editorView.cameraPosition);
      this.orbit.target.set(...scene.editorView.cameraTarget);
      this.orbit.update();
    }
    this.invalidate();
  }

  setSelection(ids: string[]): void {
    this.selection = [...ids];
    this.refreshSelectionHelpers();
    this.reattachGizmo();
    this.invalidate();
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    if (mode !== 'select') this.gizmo.setMode(mode);
    this.reattachGizmo();
    this.invalidate();
  }

  setSpace(space: 'world' | 'local'): void {
    this.gizmo.setSpace(space);
    this.invalidate();
  }

  setSnap(snap: SnapSettings): void {
    this.gizmo.setTranslationSnap(snap.translate);
    this.gizmo.setRotationSnap(snap.rotate === null ? null : MathUtils.degToRad(snap.rotate));
    this.gizmo.setScaleSnap(snap.scale);
  }

  setShowGrid(show: boolean): void {
    this.showGrid = show;
    this.updateGrids();
    this.invalidate();
  }

  setShowColliders(show: boolean): void {
    this.showColliders = show;
    this.refreshSelectionHelpers();
    this.invalidate();
  }

  setCameraSettings(settings: { rotateSpeed: number; zoomSpeed: number; panSpeed: number; invertY: boolean }): void {
    this.orbit.rotateSpeed = settings.rotateSpeed * (settings.invertY ? -1 : 1);
    this.orbit.zoomSpeed = settings.zoomSpeed;
    this.orbit.panSpeed = settings.panSpeed;
  }

  /** Returns true if the new quality needs the viewport to be recreated. */
  setQuality(level: QualityLevel): boolean {
    const needsRecreate = this.context.setQuality(level);
    this.sync.setShadowMapSize(QUALITY_PRESETS[level].shadowMapSize);
    if (this.sceneData) this.environment.apply(this.sceneData.environment, this.context.getEnvironment());
    this.invalidate();
    return needsRecreate;
  }

  /** Stops rendering (used while play mode owns the canvas). */
  pause(): void {
    this.paused = true;
    this.gizmo.detach();
    this.orbit.enabled = false;
  }

  resume(): void {
    this.paused = false;
    this.orbit.enabled = true;
    this.context.resize(true);
    this.camera.aspect = this.context.size.width / this.context.size.height;
    this.camera.updateProjectionMatrix();
    this.reattachGizmo();
    this.invalidate();
  }

  /** Smoothly frames the selected objects (or the whole scene). */
  frameSelection(ids: string[] = this.selection): void {
    const box = new Box3();
    const targets = ids.length ? ids : [...this.sync.nodes.keys()];
    for (const id of targets) {
      const node = this.sync.getNode(id);
      if (!node) continue;
      if (node.data.type === 'baseplate' && ids.length === 0) continue;
      const b = new Box3().setFromObject(node.root, true);
      if (!b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) {
      this.resetView();
      return;
    }
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
    const distance = Math.min(radius / Math.sin(MathUtils.degToRad(this.camera.fov / 2)), 1500) * 1.15;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.5, 1).normalize();
    this.tweenCamera(center.clone().addScaledVector(dir, distance), center);
  }

  resetView(): void {
    this.tweenCamera(new Vector3(18, 14, 26), new Vector3(0, 0, 0));
  }

  getCameraState(): { position: Vec3; target: Vec3 } {
    return {
      position: roundVec3([this.camera.position.x, this.camera.position.y, this.camera.position.z], 3),
      target: roundVec3([this.orbit.target.x, this.orbit.target.y, this.orbit.target.z], 3),
    };
  }

  /** A point in front of the camera on the ground, where new objects are placed. */
  getSpawnPoint(): Vec3 {
    const t = this.orbit.target;
    return roundVec3([Math.round(t.x), 0, Math.round(t.z)], 2);
  }

  captureThumbnail(): string | null {
    const gizmoVisible = this.gizmo.getHelper().visible;
    this.gizmo.getHelper().visible = false;
    this.overlay.visible = false;
    this.gridGroup.visible = false;
    const shot = this.context.captureThumbnail(() => this.renderNow());
    this.overlay.visible = true;
    this.gridGroup.visible = true;
    this.gizmo.getHelper().visible = gizmoVisible;
    this.invalidate();
    return shot;
  }

  invalidate(): void {
    if (this.renderQueued || this.disposed || this.paused) return;
    this.renderQueued = true;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.cameraChangeTimer) clearTimeout(this.cameraChangeTimer);
    const canvas = this.context.canvas;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    for (const h of this.selectionHelpers.values()) h.dispose();
    this.clearColliderHelpers();
    for (const g of this.baseplateGrids.values()) g.dispose();
    this.infiniteGrid.dispose();
    this.environment.dispose();
    this.sync.dispose();
    this.context.dispose();
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private frame = (time: number) => {
    this.renderQueued = false;
    if (this.disposed || this.paused) return;
    let keepGoing = false;
    if (this.cameraTween) {
      const tw = this.cameraTween;
      const k = Math.min(1, (time - tw.t0) / tw.duration);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      this.orbit.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (k >= 1) {
        this.cameraTween = null;
        this.scheduleCameraChange();
      }
      keepGoing = true;
    }
    if (this.orbit.update()) keepGoing = true;
    this.renderNow();
    if (keepGoing) this.invalidate();
  };

  private renderNow(): void {
    if (this.context.isContextLost) return;
    const distance = this.camera.position.distanceTo(this.orbit.target);
    this.infiniteGrid.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.infiniteGrid.update(this.camera, distance);
    for (const grid of this.baseplateGrids.values()) grid.update(this.camera, distance);
    for (const helper of this.selectionHelpers.values()) helper.update();
    if (this.colliderHelpers.length) this.updateColliderFrames();
    const preset = QUALITY_PRESETS[this.context.quality];
    this.sync.updateSunShadows(this.orbit.target, Math.min(preset.shadowDistance, Math.max(20, distance * 1.2)));
    this.context.renderer.render(this.scene, this.camera);
  }

  private tweenCamera(position: Vector3, target: Vector3): void {
    this.cameraTween = {
      from: this.camera.position.clone(),
      to: position,
      fromTarget: this.orbit.target.clone(),
      toTarget: target,
      t0: performance.now(),
      duration: 380,
    };
    this.invalidate();
  }

  private scheduleCameraChange(): void {
    if (!this.callbacks.onCameraChange) return;
    if (this.cameraChangeTimer) clearTimeout(this.cameraChangeTimer);
    this.cameraChangeTimer = setTimeout(() => {
      const s = this.getCameraState();
      this.callbacks.onCameraChange?.(s.position, s.target);
    }, 400);
  }

  // ── Grids ──────────────────────────────────────────────────────────────

  private updateGrids(): void {
    const scene = this.sceneData;
    const baseplates = scene ? scene.objects.filter((o) => o.type === 'baseplate') : [];
    const wanted = new Set<string>();
    for (const bp of baseplates) {
      const node = this.sync.getNode(bp.id);
      const comp = bp.components.baseplate;
      if (!node || !comp?.showGrid) continue;
      wanted.add(bp.id);
      let grid = this.baseplateGrids.get(bp.id);
      if (!grid) {
        grid = new AdaptiveGrid();
        this.baseplateGrids.set(bp.id, grid);
      }
      grid.setSize(comp.width, comp.depth);
      grid.position.set(0, 0.002, 0);
      // Attached to the baseplate's transform root (not its mesh): independent of the surface material.
      if (grid.parent !== node.root) node.root.add(grid);
      grid.visible = this.showGrid;
    }
    for (const [id, grid] of this.baseplateGrids) {
      if (!wanted.has(id)) {
        grid.removeFromParent();
        grid.dispose();
        this.baseplateGrids.delete(id);
      }
    }
    // The infinite ground grid is shown when there is no visible baseplate grid.
    this.infiniteGrid.visible = this.showGrid && wanted.size === 0;
  }

  // ── Selection and gizmo ────────────────────────────────────────────────

  private refreshSelectionHelpers(): void {
    for (const [id, helper] of this.selectionHelpers) {
      if (!this.selection.includes(id) || !this.sync.getNode(id)) {
        helper.removeFromParent();
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
    }
    for (const id of this.selection) {
      const node = this.sync.getNode(id);
      if (!node || this.selectionHelpers.has(id)) continue;
      const helper = new BoxHelper(node.root, SELECT_COLOR);
      (helper.material as LineBasicMaterial).depthTest = false;
      (helper.material as LineBasicMaterial).transparent = true;
      (helper.material as LineBasicMaterial).opacity = 0.9;
      helper.renderOrder = 999;
      helper.userData.editorHelper = true;
      this.overlay.add(helper);
      this.selectionHelpers.set(id, helper);
    }
    this.clearColliderHelpers();
    if (this.showColliders && this.sceneData) {
      for (const obj of this.sceneData.objects) {
        const shape = colliderShapeFor(obj, this.assets);
        const node = this.sync.getNode(obj.id);
        if (!shape || !node) continue;
        const lines = colliderWireframe(shape);
        lines.userData.editorHelper = true;
        // Colliders carry scale baked in, so attach to an unscaled frame matching the object.
        const frame = new Group();
        frame.add(lines);
        frame.userData.followId = obj.id;
        this.overlay.add(frame);
        this.colliderHelpers.push(lines);
      }
      this.updateColliderFrames();
    }
  }

  private updateColliderFrames(): void {
    const pos = new Vector3();
    const scale = new Vector3();
    for (const lines of this.colliderHelpers) {
      const frame = lines.parent;
      if (!frame) continue;
      const node = this.sync.getNode(frame.userData.followId as string);
      if (!node) continue;
      node.root.updateWorldMatrix(true, false);
      node.root.matrixWorld.decompose(pos, frame.quaternion, scale);
      frame.position.copy(pos);
      frame.visible = this.sync.isEffectivelyVisible(node.id);
    }
  }

  private clearColliderHelpers(): void {
    for (const lines of this.colliderHelpers) {
      lines.parent?.removeFromParent();
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
    }
    this.colliderHelpers.length = 0;
  }

  private reattachGizmo(): void {
    if (this.paused) return;
    const primary = this.selection.at(-1);
    const node = primary ? this.sync.getNode(primary) : undefined;
    if (!node || this.mode === 'select' || node.data.locked) {
      this.gizmo.detach();
      return;
    }
    if (this.gizmo.object !== node.root) this.gizmo.attach(node.root);
  }

  private beginDrag(): void {
    this.dragStart.clear();
    for (const id of this.selection) {
      const node = this.sync.getNode(id);
      if (!node || node.data.locked) continue;
      this.dragStart.set(id, { transform: structuredClone(node.data.transform), world: node.root.getWorldPosition(new Vector3()) });
    }
  }

  private currentTransform(root: Object3D): Transform {
    return {
      position: roundVec3([root.position.x, root.position.y, root.position.z]),
      rotation: roundVec3([root.rotation.x * RAD2DEG, root.rotation.y * RAD2DEG, root.rotation.z * RAD2DEG], 3),
      scale: roundVec3([root.scale.x, root.scale.y, root.scale.z]),
    };
  }

  private collectDragChanges(): TransformChange[] {
    const primary = this.gizmo.object;
    const primaryId = primary ? this.sync.objectIdFor(primary) : null;
    const primaryStart = primaryId ? this.dragStart.get(primaryId) : undefined;
    const changes: TransformChange[] = [];
    if (!primary || !primaryId || !primaryStart) return changes;
    // Moving several objects: apply the primary's world-space offset to the others.
    if (this.gizmo.mode === 'translate' && this.dragStart.size > 1) {
      const delta = primary.getWorldPosition(new Vector3()).sub(primaryStart.world);
      for (const [id, start] of this.dragStart) {
        if (id === primaryId) continue;
        const node = this.sync.getNode(id);
        if (!node) continue;
        const world = start.world.clone().add(delta);
        const local = node.root.parent ? node.root.parent.worldToLocal(world) : world;
        node.root.position.copy(local);
      }
    }
    for (const [id, start] of this.dragStart) {
      const node = this.sync.getNode(id);
      if (!node) continue;
      if (id !== primaryId && this.gizmo.mode !== 'translate') continue;
      changes.push({ id, before: start.transform, after: this.currentTransform(node.root) });
    }
    return changes;
  }

  private previewDrag(): void {
    const changes = this.collectDragChanges();
    if (changes.length) this.callbacks.onTransformPreview?.(changes);
    this.invalidate();
  }

  private endDrag(): void {
    const changes = this.collectDragChanges();
    this.dragStart.clear();
    if (changes.length) this.callbacks.onTransformCommit?.(changes);
  }

  // ── Picking ────────────────────────────────────────────────────────────

  private handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    this.pointerDown = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId };
  };

  private handlePointerCancel = () => {
    this.pointerDown = null;
  };

  private handlePointerUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.id !== event.pointerId || this.gizmo.dragging) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > TAP_MAX_MOVE || performance.now() - down.t > TAP_MAX_MS) return;
    // Ignore taps that landed on the gizmo handles.
    if (this.gizmo.axis) return;
    const id = this.pick(event.clientX, event.clientY);
    this.callbacks.onPick?.(id, event.shiftKey || event.metaKey || event.ctrlKey);
  };

  /** Returns the id of the closest visible, unlocked object under a screen point. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.context.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.sync.root, true);
    for (const hit of hits) {
      if (hit.object.userData.isOutline) continue;
      const id = this.sync.objectIdFor(hit.object);
      if (!id) continue;
      const node = this.sync.getNode(id);
      if (!node || node.data.locked || !this.sync.isEffectivelyVisible(id)) continue;
      return id;
    }
    return null;
  }
}

function colliderWireframe(shape: ColliderShapeDesc): LineSegments {
  let geometry: BufferGeometry;
  switch (shape.kind) {
    case 'box': {
      const box = new BoxGeometry(shape.halfExtents[0] * 2, shape.halfExtents[1] * 2, shape.halfExtents[2] * 2);
      geometry = new EdgesGeometry(box);
      box.dispose();
      break;
    }
    case 'ball': {
      const s = new SphereGeometry(shape.radius, 12, 8);
      geometry = new WireframeGeometry(s);
      s.dispose();
      break;
    }
    case 'capsule': {
      const c = new CapsuleGeometry(shape.radius, shape.halfHeight * 2, 4, 10);
      geometry = new WireframeGeometry(c);
      c.dispose();
      break;
    }
    case 'cylinder': {
      const c = new CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 16, 1);
      geometry = new EdgesGeometry(c, 30);
      c.dispose();
      break;
    }
    case 'cone': {
      const c = new ConeGeometry(shape.radius, shape.halfHeight * 2, 16, 1);
      geometry = new EdgesGeometry(c, 30);
      c.dispose();
      break;
    }
  }
  geometry.translate(shape.offset[0], shape.offset[1], shape.offset[2]);
  const material = new LineBasicMaterial({ color: COLLIDER_COLOR, depthTest: false, transparent: true, opacity: 0.85 });
  const lines = new LineSegments(geometry, material);
  lines.renderOrder = 998;
  return lines;
}
