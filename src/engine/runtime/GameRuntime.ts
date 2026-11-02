import {
  AnimationMixer,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Euler,
  Group,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  type Object3D,
} from 'three';
import type { AssetCache } from '../assets/AssetCache';
import type { GameAudio } from '../audio/GameAudio';
import { DEG2RAD, RAD2DEG, type Vec3 } from '../core/math';
import type { InputState } from '../input/InputState';
import { PhysicsWorld, type Quat } from '../physics/PhysicsWorld';
import { colliderShapeFor } from '../physics/shapes';
import type { AssetMeta, ProjectSettings } from '../project/types';
import { QUALITY_PRESETS } from '../renderer/quality';
import type { RenderContext } from '../renderer/RenderContext';
import { SceneEnvironment } from '../renderer/SceneEnvironment';
import { SceneSync, type SceneNode } from '../renderer/SceneSync';
import type { SceneData, SceneObject } from '../scene/types';
import type { Program } from '../scripting/ast';
import { ScriptInstance, type ScriptHost, type ScriptRuntimeError } from '../scripting/interpreter';

/**
 * Play mode runtime. It works on a snapshot of the scene and builds its own
 * Three.js scene, physics world and script instances, so stopping simply
 * throws everything away and the editor state is untouched.
 * It can run headless (no renderer) for automated tests.
 */

export const PLAYER_ID = '__player';
const PLAYER_RADIUS = 0.5;
const PLAYER_HALF_HEIGHT = 0.5;
const FALL_LIMIT = -150;

export type CompiledRuntimeScript =
  | { id: string; name: string; program: Program; error?: undefined }
  | { id: string; name: string; program: null; error: string };

export interface ScriptErrorInfo {
  scriptName: string;
  objectName: string;
  message: string;
  line?: number;
}

export interface RuntimeCallbacks {
  onMessage?: (text: string) => void;
  onScore?: (score: number) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
  onScriptError?: (info: ScriptErrorInfo) => void;
  onFatal?: (message: string) => void;
}

export interface GameRuntimeOptions {
  scene: SceneData;
  settings: ProjectSettings;
  assets: Record<string, AssetMeta>;
  scripts: Record<string, CompiledRuntimeScript>;
  assetCache: AssetCache;
  input: InputState;
  /** Null runs headless (tests). */
  context: RenderContext | null;
  audio?: GameAudio | null;
  fallbackCamera?: { position: Vec3; target: Vec3 };
  showColliders?: boolean;
  callbacks?: RuntimeCallbacks;
  random?: () => number;
}

interface Attached {
  objectId: string;
  instance: ScriptInstance;
}

export class GameRuntime {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 5000);
  private readonly sync: SceneSync;
  private readonly environment: SceneEnvironment | null;
  private physics: PhysicsWorld | null = null;
  private readonly instances: Attached[] = [];
  private readonly alive = new Set<string>();
  private readonly byId = new Map<string, SceneObject>();
  private readonly children = new Map<string, string[]>();
  private readonly dirtyBodies = new Set<string>();
  private readonly mixers = new Map<string, AnimationMixer>();
  private player: Group | null = null;
  private playerVisual: Object3D | null = null;
  private spawnPosition = new Vector3(0, 3, 0);
  private yaw = 0;
  private pitch = -0.35;
  private cameraDistance = 9;
  private elapsed = 0;
  private _score = 0;
  private running = false;
  private frameHandle = 0;
  private lastTime = 0;
  private debugLines: LineSegments | null = null;
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly tmpS = new Vector3();

  private constructor(private readonly options: GameRuntimeOptions) {
    this.sync = new SceneSync({
      mode: 'game',
      assets: options.assetCache,
      onAsyncChange: () => this.setupAnimations(),
      onAssetError: (name, msg) => options.callbacks?.onLog?.('warn', `Could not load model for "${name}": ${msg}`),
    });
    this.scene.add(this.sync.root, this.sync.lightRig);
    this.environment = options.context ? new SceneEnvironment(this.scene) : null;
  }

  static async start(options: GameRuntimeOptions): Promise<GameRuntime> {
    const runtime = new GameRuntime(options);
    try {
      await runtime.init();
    } catch (err) {
      runtime.stop();
      throw err;
    }
    return runtime;
  }

  get score(): number {
    return this._score;
  }

  get time(): number {
    return this.elapsed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get hasPlayer(): boolean {
    return this.player !== null;
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    const { scene, context } = this.options;
    for (const o of scene.objects) {
      this.byId.set(o.id, o);
      this.alive.add(o.id);
      if (o.parentId) this.children.set(o.parentId, [...(this.children.get(o.parentId) ?? []), o.id]);
    }
    this.sync.sync(scene);
    if (context) {
      this.environment?.apply(scene.environment, context.getEnvironment());
      this.sync.setShadowMapSize(QUALITY_PRESETS[context.quality].shadowMapSize);
    }
    this.sync.root.updateMatrixWorld(true);

    this.physics = await PhysicsWorld.create(scene.environment.gravity);
    for (const obj of scene.objects) this.addBody(obj);
    this.setupPlayer();
    this.setupCamera();
    this.setupScripts();
    if (this.options.showColliders && context) {
      this.debugLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#3ddc84', depthTest: false }));
      this.debugLines.renderOrder = 999;
      this.debugLines.frustumCulled = false;
      this.scene.add(this.debugLines);
    }
    this.running = true;
    for (const a of this.instances) a.instance.start();
    if (context) {
      this.lastTime = performance.now();
      this.frameHandle = requestAnimationFrame(this.loop);
    }
  }

  private hasScripts(obj: SceneObject): boolean {
    return (obj.components.scripts ?? []).some((s) => s.enabled);
  }

  private worldTransform(node: SceneNode): { position: Vec3; rotation: Quat } {
    node.root.updateWorldMatrix(true, false);
    node.root.matrixWorld.decompose(this.tmpV, this.tmpQ, this.tmpS);
    return {
      position: [this.tmpV.x, this.tmpV.y, this.tmpV.z],
      rotation: [this.tmpQ.x, this.tmpQ.y, this.tmpQ.z, this.tmpQ.w],
    };
  }

  private addBody(obj: SceneObject): void {
    const physics = this.physics;
    const node = this.sync.getNode(obj.id);
    if (!physics || !node) return;
    const shape = colliderShapeFor(obj, this.options.assets);
    if (!shape) return;
    const collider = obj.components.collider;
    const rb = obj.components.rigidBody;
    const bodyType = rb?.type ?? (this.hasScripts(obj) ? 'kinematic' : 'static');
    const t = this.worldTransform(node);
    physics.add(obj.id, {
      shape,
      bodyType,
      position: t.position,
      rotation: t.rotation,
      mass: rb?.mass ?? 1,
      friction: rb?.friction ?? 0.6,
      restitution: rb?.restitution ?? 0.1,
      gravityScale: rb?.gravityScale ?? 1,
      linearDamping: rb?.linearDamping ?? 0.05,
      angularDamping: rb?.angularDamping ?? 0.1,
      isTrigger: collider?.isTrigger ?? false,
      reportCollisions: true,
    });
  }

  private setupPlayer(): void {
    const { settings, scene } = this.options;
    const spawn = scene.objects.find((o) => o.type === 'spawnPoint');
    if (!settings.player.enabled || !spawn || !this.physics) return;
    const node = this.sync.getNode(spawn.id);
    if (node) {
      const t = this.worldTransform(node);
      this.spawnPosition.set(...t.position);
      this.yaw = new Euler().setFromQuaternion(new Quaternion(...t.rotation), 'YXZ').y;
    }
    const player = new Group();
    player.name = 'Player';
    player.userData.zinoId = PLAYER_ID;
    const material = new MeshStandardMaterial({ color: settings.player.color, roughness: 0.5 });
    const body = new Mesh(new CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 6, 16), material);
    body.castShadow = true;
    const visor = new Mesh(new BoxGeometry(0.6, 0.22, 0.2), new MeshStandardMaterial({ color: '#1b2233', roughness: 0.2, metalness: 0.4 }));
    visor.position.set(0, 0.45, -0.42);
    const visual = new Group();
    visual.add(body, visor);
    player.add(visual);
    this.playerVisual = visual;
    player.position.copy(this.spawnPosition);
    this.scene.add(player);
    this.player = player;
    if (settings.player.cameraMode === 'firstPerson') visual.visible = false;
    this.physics.add(PLAYER_ID, {
      shape: { kind: 'capsule', halfHeight: PLAYER_HALF_HEIGHT, radius: PLAYER_RADIUS, offset: [0, 0, 0] },
      bodyType: 'dynamic',
      position: [this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z],
      rotation: [0, 0, 0, 1],
      mass: 1,
      friction: 0,
      restitution: 0,
      gravityScale: 1.6,
      linearDamping: 0,
      angularDamping: 0,
      isTrigger: false,
      lockRotations: true,
      reportCollisions: true,
    });
  }

  private setupCamera(): void {
    const size = this.options.context?.size;
    if (size) this.camera.aspect = size.width / size.height;
    const fallback = this.options.fallbackCamera;
    if (fallback) {
      this.camera.position.set(...fallback.position);
      this.camera.lookAt(...fallback.target);
    }
    this.camera.updateProjectionMatrix();
  }

  private setupScripts(): void {
    const { scene, scripts, callbacks } = this.options;
    for (const obj of scene.objects) {
      for (const attachment of obj.components.scripts ?? []) {
        if (!attachment.enabled) continue;
        const script = scripts[attachment.scriptId];
        if (!script) {
          callbacks?.onLog?.('warn', `"${obj.name}" uses a script that no longer exists`);
          continue;
        }
        if (!script.program) {
          callbacks?.onScriptError?.({ scriptName: script.name, objectName: obj.name, message: script.error });
          continue;
        }
        const instance = new ScriptInstance(script.program, this.host, obj.id, {
          scriptName: script.name,
          onError: (error: ScriptRuntimeError) =>
            callbacks?.onScriptError?.({
              scriptName: script.name,
              objectName: obj.name,
              message: error.message,
              line: error.loc?.line,
            }),
        });
        this.instances.push({ objectId: obj.id, instance });
      }
    }
  }

  private setupAnimations(): void {
    for (const [id, obj] of this.byId) {
      const clipName = obj.components.model?.animation;
      if (!clipName || this.mixers.has(id) || !this.alive.has(id)) continue;
      const node = this.sync.getNode(id);
      if (!node?.content || node.animations.length === 0) continue;
      const clip = node.animations.find((c) => c.name === clipName);
      if (!clip) continue;
      const mixer = new AnimationMixer(node.content);
      const action = mixer.clipAction(clip);
      action.setLoop(obj.components.model?.loopAnimation ? LoopRepeat : LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.play();
      this.mixers.set(id, mixer);
    }
  }

  // ── Frame loop ─────────────────────────────────────────────────────────

  private loop = (time: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.step(dt);
    if (this.running) this.frameHandle = requestAnimationFrame(this.loop);
  };

  /** Advances the game by `dt` seconds. Called by the frame loop, or directly by tests. */
  step(dt: number): void {
    if (!this.running || !this.physics) return;
    try {
      this.elapsed += dt;
      const input = this.options.input;
      const pressed = input.consumePressed();
      for (const button of pressed) for (const a of this.instances) a.instance.button(button);
      this.updatePlayer(dt, pressed);
      for (const a of this.instances) a.instance.update(dt);
      this.flushDirtyBodies();
      const events = this.physics.step(dt);
      this.syncFromPhysics();
      for (const e of events) {
        if (!e.started) continue;
        this.dispatchCollision(e.a, e.b);
        this.dispatchCollision(e.b, e.a);
      }
      this.flushDirtyBodies();
      for (const mixer of this.mixers.values()) mixer.update(dt);
      this.updateCamera(input);
      this.render();
    } catch (err) {
      this.options.callbacks?.onFatal?.(`The game stopped because of an unexpected error: ${(err as Error)?.message ?? err}`);
      this.stop();
    }
  }

  private dispatchCollision(selfId: string, otherId: string): void {
    for (const a of this.instances) {
      if (a.objectId === selfId && this.alive.has(selfId)) a.instance.collision(otherId);
    }
  }

  private flushDirtyBodies(): void {
    if (!this.physics) return;
    for (const id of this.dirtyBodies) {
      const node = this.sync.getNode(id);
      if (!node || !this.physics.has(id)) continue;
      const t = this.worldTransform(node);
      this.physics.setTransform(id, t.position, t.rotation);
    }
    this.dirtyBodies.clear();
  }

  private syncFromPhysics(): void {
    const physics = this.physics;
    if (!physics) return;
    for (const id of this.alive) {
      const type = physics.bodyType(id);
      if (type !== 'dynamic') continue;
      const t = physics.getTransform(id);
      const node = this.sync.getNode(id);
      if (!t || !node) continue;
      this.tmpV.set(...t.position);
      this.tmpQ.set(...t.rotation);
      const parent = node.root.parent;
      if (parent && parent !== this.sync.root) {
        parent.updateWorldMatrix(true, false);
        node.root.position.copy(parent.worldToLocal(this.tmpV.clone()));
        const parentQ = parent.getWorldQuaternion(new Quaternion()).invert();
        node.root.quaternion.copy(parentQ.multiply(this.tmpQ));
      } else {
        node.root.position.copy(this.tmpV);
        node.root.quaternion.copy(this.tmpQ);
      }
    }
    if (this.player) {
      const t = physics.getTransform(PLAYER_ID);
      if (t) this.player.position.set(...t.position);
      if (this.player.position.y < FALL_LIMIT) this.respawnPlayer();
    }
  }

  private updatePlayer(dt: number, pressed: string[]): void {
    const physics = this.physics;
    if (!this.player || !physics) return;
    const { moveSpeed, jumpPower } = this.options.settings.player;
    const axis = this.options.input.moveAxis();
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = right.multiplyScalar(axis.x).add(forward.multiplyScalar(axis.y)).multiplyScalar(moveSpeed);
    const velocity = physics.getVelocity(PLAYER_ID) ?? [0, 0, 0];
    let vy = velocity[1];
    if (pressed.includes('jump') && physics.isGrounded(PLAYER_ID, PLAYER_HALF_HEIGHT + PLAYER_RADIUS)) {
      vy = jumpPower;
      this.options.audio?.play('jump');
    }
    physics.setVelocity(PLAYER_ID, [move.x, vy, move.z]);
    if (this.playerVisual && move.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(-move.x, -move.z);
      let diff = targetYaw - this.playerVisual.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.playerVisual.rotation.y += diff * Math.min(1, dt * 12);
    }
  }

  private respawnPlayer(): void {
    if (!this.physics || !this.player) return;
    this.physics.setTransform(PLAYER_ID, [this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z], [0, 0, 0, 1]);
    this.physics.setVelocity(PLAYER_ID, [0, 0, 0]);
    this.player.position.copy(this.spawnPosition);
  }

  /** Mouse wheel / pinch zoom for the follow camera. */
  zoom(delta: number): void {
    this.cameraDistance = Math.min(30, Math.max(3, this.cameraDistance * (1 + delta)));
  }

  private updateCamera(input: InputState): void {
    const look = input.consumeLook();
    this.yaw -= look.x * 0.005;
    this.pitch = Math.min(1.2, Math.max(-1.3, this.pitch - look.y * 0.004));
    const size = this.options.context?.size;
    if (size && Math.abs(this.camera.aspect - size.width / size.height) > 1e-3) {
      this.camera.aspect = size.width / size.height;
      this.camera.updateProjectionMatrix();
    }
    if (this.player) {
      const head = this.player.position.clone().add(new Vector3(0, 0.9, 0));
      if (this.options.settings.player.cameraMode === 'firstPerson') {
        this.camera.position.copy(head);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      } else {
        const offset = new Vector3(
          Math.sin(this.yaw) * Math.cos(this.pitch),
          -Math.sin(this.pitch),
          Math.cos(this.yaw) * Math.cos(this.pitch),
        ).multiplyScalar(this.cameraDistance);
        this.camera.position.copy(head).add(offset);
        if (this.camera.position.y < head.y - 0.5) this.camera.position.y = head.y - 0.5;
        this.camera.lookAt(head);
      }
      return;
    }
    const main = this.findMainCamera();
    if (main) {
      main.updateWorldMatrix(true, false);
      main.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.tmpS);
      const cam = main as PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== this.camera.fov) {
        this.camera.fov = cam.fov;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  private findMainCamera(): Object3D | null {
    let fallback: Object3D | null = null;
    for (const id of this.alive) {
      const obj = this.byId.get(id);
      if (obj?.type !== 'camera') continue;
      const node = this.sync.getNode(id);
      if (!node?.camera) continue;
      if (obj.components.camera?.isMain) return node.camera;
      fallback ??= node.camera;
    }
    return fallback;
  }

  private render(): void {
    const context = this.options.context;
    if (!context || context.isContextLost) return;
    const focus = this.player?.position ?? this.tmpV.set(0, 0, 0);
    this.sync.updateSunShadows(focus, QUALITY_PRESETS[context.quality].shadowDistance);
    if (this.debugLines && this.physics) {
      const vertices = this.physics.debugLines();
      this.debugLines.geometry.setAttribute('position', new BufferAttribute(vertices, 3));
    }
    context.renderer.render(this.scene, this.camera);
  }

  // ── Script host ────────────────────────────────────────────────────────

  private nodeFor(id: string): SceneNode | undefined {
    return this.alive.has(id) ? this.sync.getNode(id) : undefined;
  }

  private worldPosition(id: string): Vector3 | null {
    if (id === PLAYER_ID) return this.player ? this.player.position.clone() : null;
    const node = this.nodeFor(id);
    if (!node) return null;
    node.root.updateWorldMatrix(true, false);
    return node.root.getWorldPosition(new Vector3());
  }

  private setWorldPosition(id: string, p: Vector3): void {
    if (id === PLAYER_ID) {
      if (!this.player || !this.physics) return;
      this.player.position.copy(p);
      this.physics.setTransform(PLAYER_ID, [p.x, p.y, p.z], [0, 0, 0, 1]);
      return;
    }
    const node = this.nodeFor(id);
    if (!node) return;
    const parent = node.root.parent;
    if (parent && parent !== this.sync.root) {
      parent.updateWorldMatrix(true, false);
      node.root.position.copy(parent.worldToLocal(p.clone()));
    } else {
      node.root.position.copy(p);
    }
    this.markMoved(id);
  }

  private markMoved(id: string): void {
    this.dirtyBodies.add(id);
    for (const child of this.children.get(id) ?? []) this.markMoved(child);
  }

  private destroyObject(id: string): void {
    if (id === PLAYER_ID) {
      this.respawnPlayer();
      return;
    }
    if (!this.alive.has(id)) return;
    const ids = [id];
    for (let i = 0; i < ids.length; i++) ids.push(...(this.children.get(ids[i] as string) ?? []));
    for (const x of ids) {
      this.alive.delete(x);
      this.physics?.remove(x);
      this.mixers.get(x)?.stopAllAction();
      this.mixers.delete(x);
      for (const a of this.instances) if (a.objectId === x) a.instance.stop();
    }
    for (const x of ids.reverse()) this.sync.removeNode(x);
  }

  private readonly host: ScriptHost = {
    exists: (id) => (id === PLAYER_ID ? this.player !== null : this.alive.has(id)),
    findByName: (name) => {
      if (name === 'Player' && this.player) return PLAYER_ID;
      for (const id of this.alive) if (this.byId.get(id)?.name === name) return id;
      return null;
    },
    nameOf: (id) => (id === PLAYER_ID ? 'Player' : (this.byId.get(id)?.name ?? 'nothing')),
    getPosition: (id) => {
      const p = this.worldPosition(id);
      return p ? [p.x, p.y, p.z] : [0, 0, 0];
    },
    setPosition: (id, v) => this.setWorldPosition(id, new Vector3(...v)),
    translate: (id, d) => {
      const p = this.worldPosition(id);
      if (p) this.setWorldPosition(id, p.add(new Vector3(...d)));
    },
    getRotation: (id) => {
      const node = this.nodeFor(id);
      if (!node) return [0, 0, 0];
      const r = node.root.rotation;
      return [r.x * RAD2DEG, r.y * RAD2DEG, r.z * RAD2DEG];
    },
    setRotation: (id, v) => {
      const node = this.nodeFor(id);
      if (!node) return;
      node.root.rotation.set(v[0] * DEG2RAD, v[1] * DEG2RAD, v[2] * DEG2RAD, 'XYZ');
      this.markMoved(id);
    },
    rotate: (id, d) => {
      if (id === PLAYER_ID) {
        this.yaw += d[1] * DEG2RAD;
        return;
      }
      const node = this.nodeFor(id);
      if (!node) return;
      const r = node.root.rotation;
      r.set(r.x + d[0] * DEG2RAD, r.y + d[1] * DEG2RAD, r.z + d[2] * DEG2RAD, 'XYZ');
      this.markMoved(id);
    },
    setScale: (id, v) => {
      const node = this.nodeFor(id);
      if (!node) return;
      node.root.scale.set(v[0] || 1e-3, v[1] || 1e-3, v[2] || 1e-3);
      const obj = this.byId.get(id);
      if (obj && this.physics?.has(id)) {
        // Colliders have scale baked in: rebuild the body with the new size.
        const scaled = { ...obj, transform: { ...obj.transform, scale: v } };
        const velocity = this.physics.getVelocity(id);
        this.addBody(scaled);
        if (velocity) this.physics.setVelocity(id, velocity);
      }
    },
    applyImpulse: (id, v) => {
      if (!this.physics?.applyImpulse(id, v)) {
        this.options.callbacks?.onLog?.('warn', `applyForce: "${this.host.nameOf(id)}" needs a dynamic Physics Body to be pushed`);
      }
    },
    setVelocity: (id, v) => {
      this.physics?.setVelocity(id, v);
    },
    destroy: (id) => this.destroyObject(id),
    setVisible: (id, visible) => {
      if (id === PLAYER_ID && this.player) this.player.visible = visible;
      const node = this.nodeFor(id);
      if (node) node.root.visible = visible;
    },
    setColor: (id, color) => {
      const node = this.nodeFor(id);
      if (node?.material) node.material.color.set(color);
      else if (id === PLAYER_ID && this.playerVisual) {
        ((this.playerVisual.children[0] as Mesh).material as MeshStandardMaterial).color.set(color);
      }
    },
    showMessage: (text) => this.options.callbacks?.onMessage?.(text),
    addScore: (n) => {
      this._score += n;
      this.options.callbacks?.onScore?.(this._score);
    },
    setScore: (n) => {
      this._score = n;
      this.options.callbacks?.onScore?.(this._score);
    },
    getScore: () => this._score,
    playSound: (name) => this.options.audio?.play(name),
    isPressed: (button) => this.options.input.isDown(button),
    time: () => this.elapsed,
    random: () => (this.options.random ?? Math.random)(),
    log: (message) => this.options.callbacks?.onLog?.('info', message),
  };

  /** World position of an object (tests and debugging). */
  getWorldPosition(id: string): Vec3 | null {
    const p = this.worldPosition(id);
    return p ? [p.x, p.y, p.z] : null;
  }

  isAlive(id: string): boolean {
    return id === PLAYER_ID ? this.player !== null : this.alive.has(id);
  }

  stop(): void {
    this.running = false;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frameHandle);
    for (const a of this.instances) a.instance.stop();
    this.instances.length = 0;
    for (const mixer of this.mixers.values()) mixer.stopAllAction();
    this.mixers.clear();
    this.physics?.dispose();
    this.physics = null;
    if (this.player) {
      this.player.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as MeshStandardMaterial).dispose();
        }
      });
      this.player.removeFromParent();
      this.player = null;
    }
    if (this.debugLines) {
      this.debugLines.geometry.dispose();
      (this.debugLines.material as LineBasicMaterial).dispose();
      this.debugLines = null;
    }
    this.sync.dispose();
    this.environment?.dispose();
  }
}
