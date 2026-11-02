export type Vec3 = [number, number, number];

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecEquals(a: Vec3, b: Vec3, epsilon = 1e-9): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  );
}

/** Rounds to a sensible editor precision to avoid 0.30000000000000004 noise. */
export function roundTo(value: number, decimals = 4): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function roundVec3(v: Vec3, decimals = 4): Vec3 {
  return [roundTo(v[0], decimals), roundTo(v[1], decimals), roundTo(v[2], decimals)];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalises an angle in degrees to the range (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}
