import { Box3, type Mesh, type Texture } from 'three';
import { createId } from '../core/ids';
import { roundVec3, type Vec3 } from '../core/math';
import type { AssetKind, AssetMeta } from '../project/types';
import { disposeObject, parseModel } from './AssetCache';

/**
 * Extensible asset importer registry. Each importer validates the raw bytes,
 * extracts metadata, and returns what should be stored. New formats are
 * added by appending an importer to IMPORTERS.
 */

export class AssetImportError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AssetImportError';
  }
}

export type ImportStage = 'reading' | 'checking' | 'processing' | 'saving';

export interface ImportResult {
  meta: AssetMeta;
  data: ArrayBuffer;
  warnings: string[];
}

export interface AssetImporter {
  id: string;
  label: string;
  kind: AssetKind;
  extensions: string[];
  maxBytes: number;
  import(data: ArrayBuffer, fileName: string): Promise<ImportResult>;
}

const MB = 1024 * 1024;

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim().slice(0, 96) || 'Asset';
}

function extensionOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? (m[1] as string).toLowerCase() : '';
}

function meta(kind: AssetKind, fileName: string, mimeType: string, size: number): AssetMeta {
  return {
    id: createId('ast'),
    name: baseName(fileName),
    kind,
    fileName,
    mimeType,
    size,
    createdAt: new Date().toISOString(),
  };
}

async function modelInfo(data: ArrayBuffer): Promise<{ info: NonNullable<AssetMeta['model']>; warnings: string[] }> {
  let model;
  try {
    model = await parseModel(data);
  } catch (err) {
    throw new AssetImportError(
      `This model could not be read: ${(err as Error)?.message ?? err}`,
      'Make sure it is a valid glTF 2.0 file. Compressed (Draco/Meshopt/KTX2) models are not supported yet.',
    );
  }
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<string>();
  const textures = new Set<string>();
  model.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const g = mesh.geometry;
    triangles += Math.floor((g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m.uuid);
      for (const v of Object.values(m)) if (v && (v as Texture).isTexture) textures.add((v as Texture).uuid);
    }
  });
  const box = new Box3().setFromObject(model.scene, true);
  const empty = box.isEmpty();
  const info = {
    meshes,
    materials: materials.size,
    triangles,
    textures: textures.size,
    animations: model.animations.map((a, i) => a.name || `Animation ${i + 1}`),
    boundsMin: (empty ? [-0.5, -0.5, -0.5] : roundVec3([box.min.x, box.min.y, box.min.z])) as Vec3,
    boundsMax: (empty ? [0.5, 0.5, 0.5] : roundVec3([box.max.x, box.max.y, box.max.z])) as Vec3,
  };
  disposeObject(model.scene);
  const warnings: string[] = [];
  if (meshes === 0) warnings.push('This model has no visible meshes.');
  if (triangles > 500_000) warnings.push(`This model is very detailed (${triangles.toLocaleString('en-US')} triangles) and may run slowly on tablets.`);
  return { info, warnings };
}

export const glbImporter: AssetImporter = {
  id: 'glb',
  label: 'Binary glTF model (.glb)',
  kind: 'model',
  extensions: ['glb'],
  maxBytes: 150 * MB,
  async import(data, fileName) {
    const view = new DataView(data);
    if (data.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) {
      throw new AssetImportError('This file is not a valid .glb model (the file header is wrong).');
    }
    const version = view.getUint32(4, true);
    if (version !== 2) throw new AssetImportError(`Only glTF 2.0 is supported (this file is version ${version}).`);
    const { info, warnings } = await modelInfo(data);
    return { meta: { ...meta('model', fileName, 'model/gltf-binary', data.byteLength), model: info }, data, warnings };
  },
};

export const gltfImporter: AssetImporter = {
  id: 'gltf',
  label: 'glTF model (.gltf, self-contained)',
  kind: 'model',
  extensions: ['gltf'],
  maxBytes: 150 * MB,
  async import(data, fileName) {
    let json: { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    try {
      json = JSON.parse(new TextDecoder().decode(data));
    } catch {
      throw new AssetImportError('This .gltf file is not valid JSON.');
    }
    if (!json.asset?.version?.startsWith('2')) throw new AssetImportError('Only glTF 2.0 files are supported.');
    const external = [...(json.buffers ?? []), ...(json.images ?? [])]
      .map((b) => b.uri)
      .filter((u): u is string => typeof u === 'string' && !u.startsWith('data:'));
    if (external.length) {
      throw new AssetImportError(
        `This .gltf file needs other files (${external.slice(0, 3).join(', ')}) that cannot be imported on their own.`,
        'Export the model as a single .glb file instead (in Blender: File → Export → glTF 2.0, format "glTF Binary").',
      );
    }
    const { info, warnings } = await modelInfo(data);
    return { meta: { ...meta('model', fileName, 'model/gltf+json', data.byteLength), model: info }, data, warnings };
  },
};

const IMAGE_SIGNATURES: { mime: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { mime: 'image/webp', test: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

export const imageImporter: AssetImporter = {
  id: 'image',
  label: 'Image texture (.png, .jpg, .webp)',
  kind: 'texture',
  extensions: ['png', 'jpg', 'jpeg', 'webp'],
  maxBytes: 25 * MB,
  async import(data, fileName) {
    const bytes = new Uint8Array(data, 0, Math.min(16, data.byteLength));
    const sig = IMAGE_SIGNATURES.find((s) => s.test(bytes));
    if (!sig) throw new AssetImportError('This file is not a PNG, JPEG or WebP image.');
    const warnings: string[] = [];
    let width = 0;
    let height = 0;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(new Blob([data], { type: sig.mime }));
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        throw new AssetImportError('This image could not be decoded. It may be damaged.');
      }
      if (Math.max(width, height) > 4096) warnings.push('Large images (over 4096 px) use a lot of memory on tablets.');
    }
    return {
      meta: { ...meta('texture', fileName, sig.mime, data.byteLength), texture: { width, height } },
      data,
      warnings,
    };
  },
};

export const audioImporter: AssetImporter = {
  id: 'audio',
  label: 'Sound (.mp3, .wav, .m4a, .ogg)',
  kind: 'audio',
  extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'],
  maxBytes: 30 * MB,
  async import(data, fileName) {
    const ext = extensionOf(fileName);
    const mime: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg' };
    let durationSeconds: number | null = null;
    const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (Offline) {
      try {
        const ctx = new Offline(1, 1, 44100);
        const buffer = await ctx.decodeAudioData(data.slice(0));
        durationSeconds = Math.round(buffer.duration * 100) / 100;
      } catch {
        throw new AssetImportError(
          'This sound could not be decoded on this device.',
          ext === 'ogg' ? 'Safari on iPad cannot play .ogg files. Use .mp3 or .m4a instead.' : undefined,
        );
      }
    }
    return {
      meta: { ...meta('audio', fileName, mime[ext] ?? 'audio/mpeg', data.byteLength), audio: { durationSeconds } },
      data,
      warnings: [],
    };
  },
};

export const IMPORTERS: AssetImporter[] = [glbImporter, gltfImporter, imageImporter, audioImporter];

export const ACCEPTED_FILE_TYPES = IMPORTERS.flatMap((i) => i.extensions.map((e) => `.${e}`)).join(',');

const UNSUPPORTED_HINTS: Record<string, string> = {
  fbx: 'FBX files are not supported yet. Export your model as .glb (glTF Binary) instead.',
  obj: 'OBJ files are not supported yet. Convert the model to .glb (e.g. with Blender).',
  blend: 'Blender files cannot be imported directly. In Blender use File → Export → glTF 2.0 (.glb).',
  stl: 'STL files are not supported yet. Convert the model to .glb.',
  usdz: 'USDZ files are not supported yet. Convert the model to .glb.',
  heic: 'HEIC photos are not supported. Export the image as JPEG or PNG.',
};

export function findImporter(fileName: string): AssetImporter | null {
  const ext = extensionOf(fileName);
  return IMPORTERS.find((i) => i.extensions.includes(ext)) ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Reads a File with progress callbacks (FileReader reports progress; File.arrayBuffer does not). */
export function readFileWithProgress(file: Blob, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    reader.onerror = () => reject(new AssetImportError('The file could not be read.'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function importAssetFile(
  file: { name: string; size: number } & Blob,
  onProgress?: (stage: ImportStage, fraction: number) => void,
): Promise<ImportResult> {
  const importer = findImporter(file.name);
  if (!importer) {
    const ext = extensionOf(file.name);
    throw new AssetImportError(
      ext ? `".${ext}" files are not supported.` : 'This file type is not supported.',
      UNSUPPORTED_HINTS[ext] ?? `Supported files: ${ACCEPTED_FILE_TYPES.replaceAll(',', ', ')}`,
    );
  }
  if (file.size === 0) throw new AssetImportError('This file is empty.');
  if (file.size > importer.maxBytes) {
    throw new AssetImportError(
      `This file is too large (${formatBytes(file.size)}). The limit for ${importer.label} is ${formatBytes(importer.maxBytes)}.`,
    );
  }
  onProgress?.('reading', 0);
  const data = await readFileWithProgress(file, (f) => onProgress?.('reading', f));
  onProgress?.('processing', 0.5);
  const result = await importer.import(data, file.name);
  onProgress?.('saving', 0.9);
  return result;
}
