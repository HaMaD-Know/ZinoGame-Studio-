import { describe, expect, it } from 'vitest';
import { AssetCache } from './AssetCache';
import { AssetImportError, findImporter, importAssetFile } from './importers';

/** Builds a minimal valid GLB containing one triangle and one animation-free node. */
export function makeTriangleGlb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
  const bin = new Uint8Array(positions.buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = new Uint8Array([...jsonBytes, ...new Array(jsonPad).fill(0x20)]);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const u8 = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, bin.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  u8.set(bin, binStart + 8);
  return out;
}

function file(name: string, data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Object.assign(new Blob([bytes.slice().buffer as ArrayBuffer]), { name });
}

describe('Asset importers', () => {
  it('imports a GLB model and extracts mesh info and bounds', async () => {
    const result = await importAssetFile(file('Robot Arm.glb', makeTriangleGlb()));
    expect(result.meta).toMatchObject({ kind: 'model', name: 'Robot Arm', mimeType: 'model/gltf-binary' });
    expect(result.meta.model).toMatchObject({ meshes: 1, triangles: 1, boundsMin: [0, 0, 0], boundsMax: [1, 2, 0] });
    expect(result.warnings).toEqual([]);
    // The stored data can be instantiated through the asset cache.
    const cache = new AssetCache(async () => result.data);
    const model = await cache.instantiateModel(result.meta.id);
    expect(model.scene.children.length).toBeGreaterThan(0);
  });

  it('rejects damaged GLB files with a clear message', async () => {
    await expect(importAssetFile(file('bad.glb', new Uint8Array(64)))).rejects.toThrow(/not a valid .glb/);
  });

  it('explains why .gltf files with external buffers cannot be imported', async () => {
    const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 4 }] });
    const err = (await importAssetFile(file('scene.gltf', new TextEncoder().encode(json))).catch((e: unknown) => e)) as AssetImportError;
    expect(err).toBeInstanceOf(AssetImportError);
    expect(err.hint).toMatch(/\.glb/);
  });

  it('suggests a conversion for unsupported formats', async () => {
    const err = (await importAssetFile(file('car.fbx', new Uint8Array(10))).catch((e: unknown) => e)) as AssetImportError;
    expect(err.message).toMatch(/not supported/);
    expect(err.hint).toMatch(/glb/);
  });

  it('validates image signatures', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = await importAssetFile(file('grass.png', png));
    expect(result.meta).toMatchObject({ kind: 'texture', mimeType: 'image/png' });
    await expect(importAssetFile(file('fake.png', new Uint8Array(20)))).rejects.toThrow(/not a PNG/);
  });

  it('rejects empty and oversized files', async () => {
    await expect(importAssetFile(file('empty.glb', new Uint8Array(0)))).rejects.toThrow(/empty/);
    const big = Object.assign(new Blob([new Uint8Array(1)]), { name: 'big.png' });
    Object.defineProperty(big, 'size', { value: 200 * 1024 * 1024 });
    await expect(importAssetFile(big)).rejects.toThrow(/too large/);
  });

  it('finds importers by extension', () => {
    expect(findImporter('a.GLB')?.id).toBe('glb');
    expect(findImporter('b.jpeg')?.id).toBe('image');
    expect(findImporter('c.mp3')?.id).toBe('audio');
    expect(findImporter('d.txt')).toBeNull();
  });
});
