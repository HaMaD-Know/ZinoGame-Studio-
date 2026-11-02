import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import { createId } from '../core/ids';
import { BINARY_ASSET_KINDS, type AssetMeta, type ProjectBundle, type ScriptDoc } from '../project/types';
import { ProjectValidationError, validateProjectBundle } from '../project/validation';

/**
 * Project archive (.zip) import/export.
 *
 * Layout (see docs/PROJECT_FORMAT.md):
 *   <Project Name>/project.zino                manifest + file index
 *   <Project Name>/Scenes/<name>.zscene        scene JSON
 *   <Project Name>/Scripts/<name>.zs           script text
 *   <Project Name>/VisualScripts/<name>.zblocks block workspace JSON
 *   <Project Name>/Assets/assets.json          asset metadata
 *   <Project Name>/Assets/{Models,Textures,Audio}/<id>-<file>
 *   <Project Name>/Assets/{Materials,Prefabs}/<id>.{zmat,zprefab}
 *   <Project Name>/Settings/project-settings.json
 *   <Project Name>/Builds/
 */

export const ARCHIVE_EXTENSION = '.zinoproj.zip';
const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 1024 * 1024 * 1024;

interface FileIndex {
  scenes: Record<string, string>;
  scripts: Record<string, { text: string; blocks: string | null }>;
  assets: Record<string, string | null>;
  settings: string;
}

export interface ArchiveAsset {
  data: ArrayBuffer;
  mimeType: string;
}

export interface ImportedArchive {
  bundle: ProjectBundle;
  assets: Map<string, ArchiveAsset>;
  warnings: string[];
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export function safeFileName(name: string, fallback = 'Untitled'): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

const ASSET_FOLDERS: Record<AssetMeta['kind'], string> = {
  model: 'Assets/Models',
  texture: 'Assets/Textures',
  audio: 'Assets/Audio',
  material: 'Assets/Materials',
  prefab: 'Assets/Prefabs',
};

const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

export async function exportProjectArchive(
  bundle: ProjectBundle,
  getAsset: (assetId: string) => Promise<ArrayBuffer | null>,
): Promise<{ data: Uint8Array; fileName: string; missingAssets: string[] }> {
  const root = safeFileName(bundle.manifest.name, 'Project');
  const files: Zippable = {};
  const put = (path: string, data: Uint8Array) => {
    files[`${root}/${path}`] = data;
  };
  const index: FileIndex = { scenes: {}, scripts: {}, assets: {}, settings: 'Settings/project-settings.json' };
  const used = new Set<string>();
  const unique = (path: string) => {
    let p = path;
    let i = 2;
    while (used.has(p)) p = path.replace(/(\.[^./]+)$/, ` (${i++})$1`);
    used.add(p);
    return p;
  };

  for (const scene of Object.values(bundle.scenes)) {
    const path = unique(`Scenes/${safeFileName(scene.name, 'Scene')}.zscene`);
    index.scenes[scene.id] = path;
    put(path, json(scene));
  }
  for (const script of Object.values(bundle.scripts)) {
    const base = safeFileName(script.name, 'Script');
    const text = unique(`Scripts/${base}.zs`);
    put(text, strToU8(script.source));
    const meta = { id: script.id, name: script.name, mode: script.mode, blocks: script.blocks, textBackup: script.textBackup, createdAt: script.createdAt, updatedAt: script.updatedAt };
    const blocks = unique(`VisualScripts/${base}.zblocks`);
    put(blocks, json(meta));
    index.scripts[script.id] = { text, blocks };
  }
  const missingAssets: string[] = [];
  for (const asset of Object.values(bundle.assets)) {
    const folder = ASSET_FOLDERS[asset.kind];
    if (BINARY_ASSET_KINDS.has(asset.kind)) {
      const data = await getAsset(asset.id);
      if (!data) {
        missingAssets.push(asset.name);
        index.assets[asset.id] = null;
        continue;
      }
      const path = unique(`${folder}/${asset.id}-${safeFileName(asset.fileName || asset.name, 'asset')}`);
      put(path, new Uint8Array(data));
      index.assets[asset.id] = path;
    } else {
      const ext = asset.kind === 'material' ? 'zmat' : 'zprefab';
      const path = unique(`${folder}/${asset.id}.${ext}`);
      put(path, json(asset));
      index.assets[asset.id] = path;
    }
  }
  put('Assets/assets.json', json(Object.values(bundle.assets)));
  put(index.settings, json(bundle.manifest.settings));
  put('Builds/README.txt', strToU8('Exported game builds are placed here.\n'));
  put('project.zino', json({ ...bundle.manifest, files: index }));

  // Binary assets are usually already compressed (GLB/PNG/MP3) - store them.
  const data = zipSync(files, { level: 6 });
  return { data, fileName: `${root}${ARCHIVE_EXTENSION}`, missingAssets };
}

function findRoot(entries: Unzipped): string {
  const manifestPath = Object.keys(entries)
    .filter((p) => p.endsWith('project.zino') && !p.includes('__MACOSX'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!manifestPath) throw new ArchiveError('This file does not contain a ZinoGame project (project.zino is missing).');
  return manifestPath.slice(0, -'project.zino'.length);
}

function parseJson(entries: Unzipped, path: string, what: string): unknown {
  const bytes = entries[path];
  if (!bytes) throw new ArchiveError(`${what} is missing from the archive (${path})`);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new ArchiveError(`${what} is damaged and could not be read (${path})`);
  }
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

/**
 * Reads a project archive. When `newId` is true the project gets a fresh id
 * (import as a copy), so it never overwrites an existing project.
 */
export function importProjectArchive(data: Uint8Array, options: { newId?: boolean } = {}): ImportedArchive {
  let total = 0;
  let entries: Unzipped;
  try {
    entries = unzipSync(data, {
      filter(file) {
        total += file.originalSize;
        if (file.originalSize > MAX_ARCHIVE_ENTRY_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES) {
          throw new ArchiveError('This archive is too large to import.');
        }
        return !file.name.includes('__MACOSX');
      },
    });
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError('This file is not a valid .zip archive.');
  }
  const root = findRoot(entries);
  const manifest = parseJson(entries, `${root}project.zino`, 'The project file') as Record<string, unknown>;
  const index = (manifest.files ?? {}) as Partial<FileIndex>;
  delete manifest.files;
  const warnings: string[] = [];

  const scenes: Record<string, unknown> = {};
  for (const [id, path] of Object.entries(index.scenes ?? {})) {
    try {
      scenes[id] = parseJson(entries, root + path, `Scene ${path}`);
    } catch (err) {
      warnings.push((err as Error).message);
    }
  }

  const scripts: Record<string, Partial<ScriptDoc>> = {};
  for (const [id, files] of Object.entries(index.scripts ?? {})) {
    const textBytes = entries[root + files.text];
    let meta: Record<string, unknown> = { id, name: 'Script', mode: 'text' };
    if (files.blocks) {
      try {
        meta = parseJson(entries, root + files.blocks, `Visual script ${files.blocks}`) as Record<string, unknown>;
      } catch (err) {
        warnings.push(`${(err as Error).message}; the text version was kept`);
        meta.mode = 'text';
      }
    }
    if (!textBytes && meta.mode !== 'blocks') {
      warnings.push(`Script ${files.text} is missing`);
      continue;
    }
    scripts[id] = { ...meta, id, source: textBytes ? strFromU8(textBytes) : '' } as Partial<ScriptDoc>;
  }

  const assetList = (() => {
    try {
      const raw = parseJson(entries, `${root}Assets/assets.json`, 'The asset list');
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      warnings.push((err as Error).message);
      return [];
    }
  })() as Record<string, unknown>[];
  const assetsMeta: Record<string, unknown> = {};
  const binaries = new Map<string, ArchiveAsset>();
  for (const meta of assetList) {
    const id = typeof meta.id === 'string' ? meta.id : '';
    if (!id) continue;
    const path = index.assets?.[id];
    if (BINARY_ASSET_KINDS.has(meta.kind as AssetMeta['kind'])) {
      const bytes = path ? entries[root + path] : undefined;
      if (!bytes) {
        warnings.push(`Asset "${String(meta.name)}" is missing its file and was skipped`);
        continue;
      }
      const copy = bytes.slice().buffer as ArrayBuffer;
      binaries.set(id, { data: copy, mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : guessMime(path as string) });
    }
    assetsMeta[id] = meta;
  }

  const settingsPath = index.settings ? root + index.settings : null;
  if (settingsPath && entries[settingsPath]) {
    try {
      manifest.settings = JSON.parse(strFromU8(entries[settingsPath] as Uint8Array));
    } catch {
      warnings.push('Project settings were damaged; defaults were used');
    }
  }

  let result;
  try {
    result = validateProjectBundle({ manifest, scenes, scripts, assets: assetsMeta });
  } catch (err) {
    if (err instanceof ProjectValidationError) throw new ArchiveError(err.message);
    throw err;
  }
  const bundle = result.bundle;
  if (options.newId) bundle.manifest.id = createId('prj');
  return { bundle, assets: binaries, warnings: [...warnings, ...result.warnings] };
}
