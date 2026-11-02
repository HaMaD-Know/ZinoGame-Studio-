import type { ProjectBundle, ProjectSummary } from '../project/types';
import {
  cloneBundle,
  countObjects,
  loadValidated,
  MAX_BACKUPS_PER_PROJECT,
  ProjectLoadError,
  summarize,
  type BackupInfo,
  type DraftInfo,
  type LoadedProject,
  type ProjectStorage,
  type StorageUsage,
} from './ProjectStorage';

/** In-memory storage used by tests and as a fallback when IndexedDB is unavailable. */
export class MemoryProjectStorage implements ProjectStorage {
  readonly kind = 'memory';
  private projects = new Map<string, ProjectBundle>();
  private summaries = new Map<string, ProjectSummary>();
  private assets = new Map<string, { data: ArrayBuffer; mimeType: string; projectId: string; assetId: string }>();
  private backups: { id: number; projectId: string; createdAt: string; reason: string; bundle: ProjectBundle }[] = [];
  private drafts = new Map<string, { savedAt: string; bundle: ProjectBundle }>();
  private nextBackupId = 1;
  /** Test hook: raw records can be corrupted on purpose. */
  readonly raw = this.projects as Map<string, unknown>;

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(id: string): Promise<LoadedProject> {
    const hasBackups = this.backups.some((b) => b.projectId === id);
    if (!this.projects.has(id)) throw new ProjectLoadError('This project no longer exists.', id, hasBackups);
    return loadValidated(structuredClone(this.projects.get(id)), id, hasBackups);
  }

  async saveProject(bundle: ProjectBundle, options: { thumbnail?: string | null } = {}): Promise<void> {
    const copy = cloneBundle(bundle);
    const existing = this.summaries.get(copy.manifest.id);
    this.projects.set(copy.manifest.id, copy);
    this.summaries.set(
      copy.manifest.id,
      summarize(copy, options.thumbnail !== undefined ? options.thumbnail : (existing?.thumbnail ?? null)),
    );
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    this.summaries.delete(id);
    this.drafts.delete(id);
    this.backups = this.backups.filter((b) => b.projectId !== id);
    for (const [k, v] of this.assets) if (v.projectId === id) this.assets.delete(k);
  }

  async putAsset(projectId: string, assetId: string, data: ArrayBuffer, mimeType: string): Promise<void> {
    this.assets.set(`${projectId}/${assetId}`, { data: data.slice(0), mimeType, projectId, assetId });
  }

  async getAsset(projectId: string, assetId: string): Promise<ArrayBuffer | null> {
    return this.assets.get(`${projectId}/${assetId}`)?.data.slice(0) ?? null;
  }

  async deleteAsset(projectId: string, assetId: string): Promise<void> {
    this.assets.delete(`${projectId}/${assetId}`);
  }

  async listAssetIds(projectId: string): Promise<string[]> {
    return [...this.assets.values()].filter((a) => a.projectId === projectId).map((a) => a.assetId);
  }

  async saveBackup(bundle: ProjectBundle, reason: string): Promise<void> {
    this.backups.push({
      id: this.nextBackupId++,
      projectId: bundle.manifest.id,
      createdAt: new Date().toISOString(),
      reason,
      bundle: cloneBundle(bundle),
    });
    const mine = this.backups.filter((b) => b.projectId === bundle.manifest.id);
    const excess = mine.slice(0, Math.max(0, mine.length - MAX_BACKUPS_PER_PROJECT)).map((b) => b.id);
    this.backups = this.backups.filter((b) => !excess.includes(b.id));
  }

  async listBackups(projectId: string): Promise<BackupInfo[]> {
    return this.backups
      .filter((b) => b.projectId === projectId)
      .map((b) => ({ id: b.id, projectId: b.projectId, createdAt: b.createdAt, reason: b.reason, objectCount: countObjects(b.bundle) }))
      .sort((a, b) => b.id - a.id);
  }

  async loadBackup(backupId: number): Promise<LoadedProject> {
    const b = this.backups.find((x) => x.id === backupId);
    if (!b) throw new ProjectLoadError('Backup not found', '', false);
    return loadValidated(cloneBundle(b.bundle), b.projectId, true);
  }

  async saveDraft(bundle: ProjectBundle): Promise<void> {
    this.drafts.set(bundle.manifest.id, { savedAt: new Date().toISOString(), bundle: cloneBundle(bundle) });
  }

  async loadDraft(projectId: string): Promise<{ bundle: ProjectBundle; savedAt: string } | null> {
    const d = this.drafts.get(projectId);
    return d ? { bundle: cloneBundle(d.bundle), savedAt: d.savedAt } : null;
  }

  async clearDraft(projectId: string): Promise<void> {
    this.drafts.delete(projectId);
  }

  async listDrafts(): Promise<DraftInfo[]> {
    return [...this.drafts.entries()].map(([projectId, d]) => ({ projectId, name: d.bundle.manifest.name, savedAt: d.savedAt }));
  }

  async estimateUsage(): Promise<StorageUsage | null> {
    return null;
  }

  async clearAll(): Promise<void> {
    this.projects.clear();
    this.summaries.clear();
    this.assets.clear();
    this.backups = [];
    this.drafts.clear();
  }
}
