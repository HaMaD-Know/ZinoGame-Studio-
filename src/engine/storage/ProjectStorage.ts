import type { ProjectBundle, ProjectSummary } from '../project/types';
import { validateProjectBundle } from '../project/validation';

/**
 * Storage abstraction used by the editor. The UI never talks to IndexedDB
 * or the native filesystem directly, so backends can be swapped (e.g. a
 * native file-based backend) without touching editor code.
 */

export interface LoadedProject {
  bundle: ProjectBundle;
  warnings: string[];
}

export interface BackupInfo {
  id: number;
  projectId: string;
  createdAt: string;
  reason: string;
  objectCount: number;
}

export interface DraftInfo {
  projectId: string;
  name: string;
  savedAt: string;
}

export interface StorageUsage {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly projectId: string,
    readonly hasBackups: boolean,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export interface ProjectStorage {
  readonly kind: string;
  listProjects(): Promise<ProjectSummary[]>;
  /** Loads, migrates and validates a project. Throws ProjectLoadError if unreadable. */
  loadProject(id: string): Promise<LoadedProject>;
  saveProject(bundle: ProjectBundle, options?: { thumbnail?: string | null }): Promise<void>;
  deleteProject(id: string): Promise<void>;

  putAsset(projectId: string, assetId: string, data: ArrayBuffer, mimeType: string): Promise<void>;
  getAsset(projectId: string, assetId: string): Promise<ArrayBuffer | null>;
  deleteAsset(projectId: string, assetId: string): Promise<void>;
  listAssetIds(projectId: string): Promise<string[]>;

  saveBackup(bundle: ProjectBundle, reason: string): Promise<void>;
  listBackups(projectId: string): Promise<BackupInfo[]>;
  loadBackup(backupId: number): Promise<LoadedProject>;

  saveDraft(bundle: ProjectBundle): Promise<void>;
  loadDraft(projectId: string): Promise<{ bundle: ProjectBundle; savedAt: string } | null>;
  clearDraft(projectId: string): Promise<void>;
  listDrafts(): Promise<DraftInfo[]>;

  estimateUsage(): Promise<StorageUsage | null>;
  /** Deletes every project, asset, backup and draft. */
  clearAll(): Promise<void>;
}

export const MAX_BACKUPS_PER_PROJECT = 10;

export function countObjects(bundle: ProjectBundle): number {
  return Object.values(bundle.scenes).reduce((n, s) => n + s.objects.length, 0);
}

export function summarize(bundle: ProjectBundle, thumbnail: string | null): ProjectSummary {
  const m = bundle.manifest;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    template: m.template,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    objectCount: countObjects(bundle),
    thumbnail,
  };
}

export function loadValidated(raw: unknown, projectId: string, hasBackups: boolean): LoadedProject {
  try {
    return validateProjectBundle(raw);
  } catch (err) {
    throw new ProjectLoadError(
      `This project could not be opened: ${(err as Error).message}`,
      projectId,
      hasBackups,
    );
  }
}

/** Deep copy that also guarantees the data is JSON/structured-clone safe. */
export function cloneBundle(bundle: ProjectBundle): ProjectBundle {
  return structuredClone(bundle);
}
