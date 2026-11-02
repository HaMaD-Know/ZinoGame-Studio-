/**
 * Stable, collision-resistant identifiers for projects, scenes, objects,
 * scripts and assets. IDs are opaque strings and must never be re-used for
 * a different entity because undo history, asset references and saved
 * projects all point at them.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < count; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Creates an id such as `obj_k3j9x0a2m1q8`. */
export function createId(prefix: string, length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const ID_PATTERN = /^[a-z]+_[0-9a-z]{6,32}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
