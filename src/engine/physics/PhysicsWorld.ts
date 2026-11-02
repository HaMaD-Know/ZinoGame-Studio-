import type * as RapierNS from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../core/math';
import type { BodyType } from '../scene/types';
import { shapeVolume, type ColliderShapeDesc } from './shapes';

/**
 * Thin wrapper around Rapier (WASM). Rapier is loaded lazily the first time
 * play mode starts, so the editor never pays for it. One PhysicsWorld exists
 * per play session and is freed when play stops.
 */

type Rapier = typeof RapierNS;
let rapierPromise: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  if (!rapierPromise) {
    rapierPromise = import('@dimforge/rapier3d-compat')
      .then(async (mod) => {
        const R = ((mod as unknown as { default?: Rapier }).default ?? mod) as Rapier;
        await R.init();
        return R;
      })
      .catch((err: unknown) => {
        rapierPromise = null;
        throw new Error(`Physics engine failed to load: ${(err as Error)?.message ?? err}`);
      });
  }
  return rapierPromise;
}

export type Quat = [number, number, number, number];

export interface BodyDesc {
  shape: ColliderShapeDesc;
  bodyType: BodyType;
  position: Vec3;
  rotation: Quat;
  mass: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  isTrigger: boolean;
  lockRotations?: boolean;
  /** Report collisions for this body (needed for scripts and the player). */
  reportCollisions: boolean;
}

export interface CollisionEvent {
  a: string;
  b: string;
  started: boolean;
}

interface Entry {
  id: string;
  body: RapierNS.RigidBody;
  collider: RapierNS.Collider;
  type: BodyType;
}

export const FIXED_TIMESTEP = 1 / 60;
const MAX_SUBSTEPS = 5;

export class PhysicsWorld {
  private readonly entries = new Map<string, Entry>();
  private readonly byCollider = new Map<number, string>();
  private readonly eventQueue: RapierNS.EventQueue;
  private accumulator = 0;
  private freed = false;

  private constructor(
    private readonly R: Rapier,
    private readonly world: RapierNS.World,
  ) {
    this.eventQueue = new R.EventQueue(true);
  }

  static async create(gravity: number): Promise<PhysicsWorld> {
    const R = await loadRapier();
    return new PhysicsWorld(R, new R.World({ x: 0, y: gravity, z: 0 }));
  }

  get bodyCount(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  bodyType(id: string): BodyType | null {
    return this.entries.get(id)?.type ?? null;
  }

  add(id: string, desc: BodyDesc): void {
    if (this.entries.has(id)) this.remove(id);
    const R = this.R;
    const bodyDesc =
      desc.bodyType === 'dynamic'
        ? R.RigidBodyDesc.dynamic()
        : desc.bodyType === 'kinematic'
          ? R.RigidBodyDesc.kinematicPositionBased()
          : R.RigidBodyDesc.fixed();
    bodyDesc
      .setTranslation(desc.position[0], desc.position[1], desc.position[2])
      .setRotation({ x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] });
    if (desc.bodyType === 'dynamic') {
      bodyDesc
        .setGravityScale(desc.gravityScale)
        .setLinearDamping(desc.linearDamping)
        .setAngularDamping(desc.angularDamping)
        .setCcdEnabled(true);
      if (desc.lockRotations) bodyDesc.lockRotations();
    }
    const body = this.world.createRigidBody(bodyDesc);

    const s = desc.shape;
    let colliderDesc: RapierNS.ColliderDesc;
    switch (s.kind) {
      case 'box':
        colliderDesc = R.ColliderDesc.cuboid(s.halfExtents[0], s.halfExtents[1], s.halfExtents[2]);
        break;
      case 'ball':
        colliderDesc = R.ColliderDesc.ball(s.radius);
        break;
      case 'capsule':
        colliderDesc = R.ColliderDesc.capsule(Math.max(0.001, s.halfHeight), s.radius);
        break;
      case 'cylinder':
        colliderDesc = R.ColliderDesc.cylinder(s.halfHeight, s.radius);
        break;
      case 'cone':
        colliderDesc = R.ColliderDesc.cone(s.halfHeight, s.radius);
        break;
    }
    colliderDesc
      .setTranslation(s.offset[0], s.offset[1], s.offset[2])
      .setFriction(desc.friction)
      .setRestitution(desc.restitution)
      .setSensor(desc.isTrigger);
    if (desc.bodyType === 'dynamic') {
      const volume = Math.max(1e-4, shapeVolume(s));
      colliderDesc.setDensity(Math.max(1e-4, desc.mass) / volume);
    }
    if (desc.reportCollisions) colliderDesc.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    this.entries.set(id, { id, body, collider, type: desc.bodyType });
    this.byCollider.set(collider.handle, id);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.byCollider.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.body);
    this.entries.delete(id);
  }

  /** Advances the simulation using a fixed timestep. Returns collision events. */
  step(dt: number): CollisionEvent[] {
    if (this.freed) return [];
    this.accumulator = Math.min(this.accumulator + Math.max(0, dt), FIXED_TIMESTEP * MAX_SUBSTEPS);
    const events: CollisionEvent[] = [];
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.world.timestep = FIXED_TIMESTEP;
      this.world.step(this.eventQueue);
      this.accumulator -= FIXED_TIMESTEP;
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        const a = this.byCollider.get(h1);
        const b = this.byCollider.get(h2);
        if (a && b) events.push({ a, b, started });
      });
    }
    return events;
  }

  getTransform(id: string): { position: Vec3; rotation: Quat } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const t = entry.body.translation();
    const r = entry.body.rotation();
    return { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
  }

  /** Moves a body. Kinematic bodies move smoothly; others are teleported. */
  setTransform(id: string, position: Vec3, rotation: Quat): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const p = { x: position[0], y: position[1], z: position[2] };
    const q = { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] };
    if (entry.type === 'kinematic') {
      entry.body.setNextKinematicTranslation(p);
      entry.body.setNextKinematicRotation(q);
    } else {
      entry.body.setTranslation(p, true);
      entry.body.setRotation(q, true);
    }
  }

  applyImpulse(id: string, impulse: Vec3): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.type !== 'dynamic') return false;
    const mass = entry.body.mass();
    entry.body.applyImpulse({ x: impulse[0] * mass, y: impulse[1] * mass, z: impulse[2] * mass }, true);
    return true;
  }

  setVelocity(id: string, velocity: Vec3): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.type !== 'dynamic') return false;
    entry.body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
    return true;
  }

  getVelocity(id: string): Vec3 | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const v = entry.body.linvel();
    return [v.x, v.y, v.z];
  }

  /** True when a downward ray from the body hits something within `distance`. */
  isGrounded(id: string, halfHeight: number, distance = 0.15): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const t = entry.body.translation();
    const ray = new this.R.Ray({ x: t.x, y: t.y - halfHeight + 0.05, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(
      ray,
      distance + 0.05,
      true,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      entry.collider,
      entry.body,
    );
    return hit !== null;
  }

  /** Line segments (pairs of points) outlining every collider, for debug display. */
  debugLines(): Float32Array {
    return this.world.debugRender().vertices;
  }

  dispose(): void {
    if (this.freed) return;
    this.freed = true;
    this.entries.clear();
    this.byCollider.clear();
    this.eventQueue.free();
    this.world.free();
  }
}
