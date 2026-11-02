import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

interface ZinoDB extends DBSchema {
  projects: { key: string; value: { id: string; bundle: ProjectBundle; savedAt: string } };
  summaries: { key: string; value: ProjectSummary };
  assets: {
    key: string;
    value: { key: string; projectId: string; assetId: string; data: ArrayBuffer; mimeType: string };
    indexes: { byProject: string };
  };
  backups: {
    key: number;
    value: { id?: number; projectId: string; createdAt: string; reason: string; objectCount: number; bundle: ProjectBundle };
    indexes: { byProject: string };
  };
  drafts: { key: string; value: { projectId: string; name: string; savedAt: string; bundle: ProjectBundle } };
}

export const DB_NAME = 'zinogame-studio';
const DB_VERSION = 1;

const assetKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`;

/** IndexedDB-backed storage (browser and Capacitor WebView). */
export class IndexedDbProjectStorage implements ProjectStorage {
  readonly kind = 'indexeddb';
  private dbPromise: Promise<IDBPDatabase<ZinoDB>> | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  private db(): Promise<IDBPDatabase<ZinoDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<ZinoDB>(this.dbName, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('assets')) {
            const assets = db.createObjectStore('assets', { keyPath: 'key' });
            assets.createIndex('byProject', 'projectId');
          }
          if (!db.objectStoreNames.contains('backups')) {
            const backups = db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
            backups.createIndex('byProject', 'projectId');
          }
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'projectId' });
        },
      }).catch((err: unknown) => {
        this.dbPromise = null;
        throw new Error(`Local storage is not available: ${(err as Error)?.message ?? err}`);
      });
    }
    return this.dbPromise;
  }

  async close(): Promise<void> {
    if (this.dbPromise) (await this.dbPromise).close();
    this.dbPromise = null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const all = await db.getAll('summaries');
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(id: string): Promise<LoadedProject> {
    const db = await this.db();
    const record = await db.get('projects', id);
    const backups = await db.countFromIndex('backups', 'byProject', id);
    if (!record) throw new ProjectLoadError('This project no longer exists.', id, backups > 0);
    return loadValidated(record.bundle, id, backups > 0);
  }

  async saveProject(bundle: ProjectBundle, options: { thumbnail?: string | null } = {}): Promise<void> {
    const db = await this.db();
    const copy = cloneBundle(bundle);
    const tx = db.transaction(['projects', 'summaries'], 'readwrite');
    const existing = await tx.objectStore('summaries').get(copy.manifest.id);
    const thumbnail = options.thumbnail !== undefined ? options.thumbnail : (existing?.thumbnail ?? null);
    await tx.objectStore('projects').put({ id: copy.manifest.id, bundle: copy, savedAt: new Date().toISOString() });
    await tx.objectStore('summaries').put(summarize(copy, thumbnail));
    await tx.done;
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['projects', 'summaries', 'assets', 'backups', 'drafts'], 'readwrite');
    await tx.objectStore('projects').delete(id);
    await tx.objectStore('summaries').delete(id);
    await tx.objectStore('drafts').delete(id);
    for (const key of await tx.objectStore('assets').index('byProject').getAllKeys(id)) {
      await tx.objectStore('assets').delete(key);
    }
    for (const key of await tx.objectStore('backups').index('byProject').getAllKeys(id)) {
      await tx.objectStore('backups').delete(key);
    }
    await tx.done;
  }

  async putAsset(projectId: string, assetId: string, data: ArrayBuffer, mimeType: string): Promise<void> {
    const db = await this.db();
    await db.put('assets', { key: assetKey(projectId, assetId), projectId, assetId, data, mimeType });
  }

  async getAsset(projectId: string, assetId: string): Promise<ArrayBuffer | null> {
    const db = await this.db();
    return (await db.get('assets', assetKey(projectId, assetId)))?.data ?? null;
  }

  async deleteAsset(projectId: string, assetId: string): Promise<void> {
    const db = await this.db();
    await db.delete('assets', assetKey(projectId, assetId));
  }

  async listAssetIds(projectId: string): Promise<string[]> {
    const db = await this.db();
    const records = await db.getAllFromIndex('assets', 'byProject', projectId);
    return records.map((r) => r.assetId);
  }

  async saveBackup(bundle: ProjectBundle, reason: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('backups', 'readwrite');
    await tx.store.add({
      projectId: bundle.manifest.id,
      createdAt: new Date().toISOString(),
      reason,
      objectCount: countObjects(bundle),
      bundle: cloneBundle(bundle),
    });
    const keys = await tx.store.index('byProject').getAllKeys(bundle.manifest.id);
    const excess = keys.sort((a, b) => a - b).slice(0, Math.max(0, keys.length - MAX_BACKUPS_PER_PROJECT));
    for (const key of excess) await tx.store.delete(key);
    await tx.done;
  }

  async listBackups(projectId: string): Promise<BackupInfo[]> {
    const db = await this.db();
    const records = await db.getAllFromIndex('backups', 'byProject', projectId);
    return records
      .map((r) => ({ id: r.id as number, projectId: r.projectId, createdAt: r.createdAt, reason: r.reason, objectCount: r.objectCount }))
      .sort((a, b) => b.id - a.id);
  }

  async loadBackup(backupId: number): Promise<LoadedProject> {
    const db = await this.db();
    const record = await db.get('backups', backupId);
    if (!record) throw new ProjectLoadError('Backup not found', '', false);
    return loadValidated(record.bundle, record.projectId, true);
  }

  async saveDraft(bundle: ProjectBundle): Promise<void> {
    const db = await this.db();
    await db.put('drafts', {
      projectId: bundle.manifest.id,
      name: bundle.manifest.name,
      savedAt: new Date().toISOString(),
      bundle: cloneBundle(bundle),
    });
  }

  async loadDraft(projectId: string): Promise<{ bundle: ProjectBundle; savedAt: string } | null> {
    const db = await this.db();
    const record = await db.get('drafts', projectId);
    if (!record) return null;
    try {
      return { bundle: loadValidated(record.bundle, projectId, false).bundle, savedAt: record.savedAt };
    } catch {
      return null;
    }
  }

  async clearDraft(projectId: string): Promise<void> {
    const db = await this.db();
    await db.delete('drafts', projectId);
  }

  async listDrafts(): Promise<DraftInfo[]> {
    const db = await this.db();
    const all = await db.getAll('drafts');
    return all.map((d) => ({ projectId: d.projectId, name: d.name, savedAt: d.savedAt }));
  }

  async estimateUsage(): Promise<StorageUsage | null> {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return null;
    try {
      const est = await storage.estimate();
      const persisted = storage.persisted ? await storage.persisted() : null;
      return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
    } catch {
      return null;
    }
  }

  async clearAll(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['projects', 'summaries', 'assets', 'backups', 'drafts'], 'readwrite');
    await Promise.all([
      tx.objectStore('projects').clear(),
      tx.objectStore('summaries').clear(),
      tx.objectStore('assets').clear(),
      tx.objectStore('backups').clear(),
      tx.objectStore('drafts').clear(),
    ]);
    await tx.done;
  }
}

/** Asks the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
