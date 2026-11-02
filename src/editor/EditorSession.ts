import type { Vec3 } from '../engine/core/math';
import { CommandHistory } from '../engine/history/history';
import type { AssetMeta, ProjectBundle, ProjectSettings, ScriptDoc, ScriptMode } from '../engine/project/types';
import { createSceneObject, OBJECT_TYPE_LABELS, type CreateObjectOptions } from '../engine/scene/factory';
import {
  addObjects,
  copyObjects,
  duplicateObjects,
  getObject,
  moveInHierarchy,
  pasteObjects,
  removeObjects,
  renameObject,
  setTransform,
  topLevelIds,
  uniqueName,
  updateObject,
  type ClipboardPayload,
  type DropPosition,
} from '../engine/scene/sceneOps';
import type { Components, EnvironmentSettings, ObjectType, SceneData, SceneObject, Transform } from '../engine/scene/types';
import { createScriptDoc } from '../engine/scripting/scriptDoc';
import type { ProjectStorage } from '../engine/storage/ProjectStorage';

/**
 * EditorSession: the single source of truth for an open project.
 *
 * Framework-agnostic (no React): the UI subscribes with
 * useSyncExternalStore, the 3D viewport subscribes directly. Every scene
 * edit goes through `applySceneChange`, which records undo history and
 * schedules autosave.
 */

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
export type Tool = 'select' | 'translate' | 'rotate' | 'scale';
export type PlayState = 'edit' | 'starting' | 'playing';

export interface ConsoleEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  source: string;
  time: string;
}

export interface EditorState {
  project: ProjectBundle;
  sceneId: string;
  selection: string[];
  environmentSelected: boolean;
  tool: Tool;
  space: 'world' | 'local';
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
  playState: PlayState;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  console: ConsoleEntry[];
}

export interface AutosaveOptions {
  enabled: boolean;
  delayMs: number;
}

export interface SessionOptions {
  storage: ProjectStorage;
  autosave?: AutosaveOptions;
  appVersion?: string;
  /** Provides a thumbnail image when saving (from the viewport). */
  captureThumbnail?: () => string | null;
  /** Interval for rolling backups while editing. */
  backupIntervalMs?: number;
}

const MAX_CONSOLE = 300;

export class EditorSession {
  private state: EditorState;
  private readonly listeners = new Set<() => void>();
  private readonly history = new CommandHistory<SceneData>({ limit: 200 });
  private clipboard: ClipboardPayload | null = null;
  private previewBase: SceneData | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private savePromise: Promise<boolean> | null = null;
  private pendingResave = false;
  private lastBackupAt = Date.now();
  private consoleCounter = 0;
  private disposed = false;
  private autosave: AutosaveOptions;
  private editorView: { position: Vec3; target: Vec3 } | null = null;
  private thumbnailProvider: (() => string | null) | null = null;

  constructor(
    project: ProjectBundle,
    private readonly options: SessionOptions,
  ) {
    this.autosave = options.autosave ?? { enabled: true, delayMs: 1500 };
    this.state = {
      project,
      sceneId: project.manifest.mainSceneId,
      selection: [],
      environmentSelected: false,
      tool: 'translate',
      space: 'world',
      saveStatus: 'saved',
      saveError: null,
      lastSavedAt: project.manifest.updatedAt,
      playState: 'edit',
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      console: [],
    };
  }

  // ── Store plumbing ─────────────────────────────────────────────────────

  getState = (): EditorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<EditorState>): void {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
    };
    for (const l of [...this.listeners]) l();
  }

  get project(): ProjectBundle {
    return this.state.project;
  }

  get scene(): SceneData {
    return this.state.project.scenes[this.state.sceneId] as SceneData;
  }

  get selectedObjects(): SceneObject[] {
    const scene = this.scene;
    return this.state.selection.map((id) => getObject(scene, id)).filter((o): o is SceneObject => !!o);
  }

  get isPlaying(): boolean {
    return this.state.playState !== 'edit';
  }

  // ── Scene editing (undoable) ───────────────────────────────────────────

  private withScene(project: ProjectBundle, scene: SceneData): ProjectBundle {
    return { ...project, scenes: { ...project.scenes, [scene.id]: scene } };
  }

  /**
   * Applies an undoable change to the active scene. Returns false when the
   * change did nothing or editing is locked (play mode).
   */
  applySceneChange(
    label: string,
    change: (scene: SceneData) => SceneData,
    options: { mergeKey?: string; selection?: string[] } = {},
  ): boolean {
    if (this.isPlaying) return false;
    const before = this.previewBase ?? this.scene;
    this.previewBase = null;
    let after: SceneData;
    try {
      after = change(this.scene);
    } catch (err) {
      this.log('error', (err as Error).message, 'Editor');
      return false;
    }
    if (after === before) {
      if (this.scene !== before) this.set({ project: this.withScene(this.state.project, before) });
      return false;
    }
    const selectionAfter = (options.selection ?? this.state.selection).filter((id) => getObject(after, id));
    this.history.record({
      label,
      before,
      after,
      mergeKey: options.mergeKey,
      selectionBefore: this.state.selection,
      selectionAfter,
    });
    this.set({
      project: this.withScene(this.state.project, after),
      selection: selectionAfter,
      environmentSelected: selectionAfter.length ? false : this.state.environmentSelected,
    });
    this.markDirty();
    return true;
  }

  /** Live update without history (e.g. while dragging a gizmo). Commit later with applySceneChange. */
  previewSceneChange(change: (scene: SceneData) => SceneData): void {
    if (this.isPlaying) return;
    if (!this.previewBase) this.previewBase = this.scene;
    const next = change(this.scene);
    if (next !== this.scene) this.set({ project: this.withScene(this.state.project, next) });
  }

  cancelPreview(): void {
    if (!this.previewBase) return;
    const base = this.previewBase;
    this.previewBase = null;
    this.set({ project: this.withScene(this.state.project, base) });
  }

  undo(): void {
    if (this.isPlaying) return;
    this.previewBase = null;
    const entry = this.history.undo();
    if (!entry) return;
    this.set({
      project: this.withScene(this.state.project, entry.before),
      selection: entry.selectionBefore.filter((id) => getObject(entry.before, id)),
    });
    this.markDirty();
  }

  redo(): void {
    if (this.isPlaying) return;
    this.previewBase = null;
    const entry = this.history.redo();
    if (!entry) return;
    this.set({
      project: this.withScene(this.state.project, entry.after),
      selection: entry.selectionAfter.filter((id) => getObject(entry.after, id)),
    });
    this.markDirty();
  }

  // ── Selection & tools ──────────────────────────────────────────────────

  select(ids: string[], additive = false): void {
    let selection: string[];
    if (additive) {
      const set = new Set(this.state.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      selection = [...set];
    } else {
      selection = [...ids];
    }
    this.history.breakMerge();
    this.set({ selection: selection.filter((id) => getObject(this.scene, id)), environmentSelected: false });
  }

  selectEnvironment(): void {
    this.set({ selection: [], environmentSelected: true });
  }

  clearSelection(): void {
    this.set({ selection: [], environmentSelected: false });
  }

  setTool(tool: Tool): void {
    this.set({ tool });
  }

  setSpace(space: 'world' | 'local'): void {
    this.set({ space });
  }

  // ── Object commands ────────────────────────────────────────────────────

  createObject(type: ObjectType, options: CreateObjectOptions & { at?: Vec3 } = {}): SceneObject | null {
    const base = createSceneObject(type, options);
    base.name = uniqueName(this.scene, options.name ?? OBJECT_TYPE_LABELS[type]);
    if (options.at && !options.transform?.position) {
      const p = base.transform.position;
      base.transform.position = [options.at[0] + p[0], options.at[1] + p[1], options.at[2] + p[2]];
    }
    if (type === 'camera' && !this.scene.objects.some((o) => o.type === 'camera') && base.components.camera) {
      base.components.camera.isMain = true;
    }
    const ok = this.applySceneChange(`Add ${OBJECT_TYPE_LABELS[type]}`, (s) => addObjects(s, [base]), { selection: [base.id] });
    return ok ? base : null;
  }

  addObjectsFromTemplate(label: string, objects: SceneObject[], rootIds: string[]): boolean {
    return this.applySceneChange(label, (s) => addObjects(s, objects), { selection: rootIds });
  }

  deleteObjects(ids: string[] = this.state.selection): boolean {
    if (ids.length === 0) return false;
    const label = ids.length === 1 ? `Delete ${getObject(this.scene, ids[0] as string)?.name ?? 'object'}` : `Delete ${ids.length} objects`;
    return this.applySceneChange(label, (s) => removeObjects(s, ids), { selection: [] });
  }

  duplicateObjects(ids: string[] = this.state.selection): string[] {
    if (ids.length === 0) return [];
    let newIds: string[] = [];
    this.applySceneChange(
      ids.length === 1 ? 'Duplicate' : `Duplicate ${ids.length} objects`,
      (s) => {
        const r = duplicateObjects(s, ids);
        newIds = r.newIds;
        return r.scene;
      },
      { selection: [] },
    );
    if (newIds.length) this.set({ selection: newIds });
    return newIds;
  }

  copy(ids: string[] = this.state.selection): boolean {
    const payload = copyObjects(this.scene, ids);
    if (!payload) return false;
    this.clipboard = payload;
    return true;
  }

  get hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  paste(): string[] {
    const clip = this.clipboard;
    if (!clip) return [];
    let newIds: string[] = [];
    this.applySceneChange('Paste', (s) => {
      const r = pasteObjects(s, clip);
      newIds = r.newIds;
      return r.scene;
    });
    if (newIds.length) this.set({ selection: newIds });
    return newIds;
  }

  cut(ids: string[] = this.state.selection): boolean {
    return this.copy(ids) && this.deleteObjects(ids);
  }

  rename(id: string, name: string): boolean {
    return this.applySceneChange('Rename', (s) => renameObject(s, id, name));
  }

  setTransform(id: string, transform: Partial<Transform>, mergeKey?: string): boolean {
    return this.applySceneChange('Change transform', (s) => setTransform(s, id, transform), { mergeKey });
  }

  previewTransforms(changes: { id: string; after: Transform }[]): void {
    this.previewSceneChange((s) => changes.reduce((acc, c) => setTransform(acc, c.id, c.after), s));
  }

  commitTransforms(changes: { id: string; after: Transform }[], label = 'Move'): boolean {
    return this.applySceneChange(label, (s) => changes.reduce((acc, c) => setTransform(acc, c.id, c.after), s));
  }

  updateObject(id: string, label: string, updater: (o: SceneObject) => SceneObject, mergeKey?: string): boolean {
    return this.applySceneChange(label, (s) => updateObject(s, id, updater), { mergeKey });
  }

  updateComponents(id: string, label: string, patch: Partial<Components>, mergeKey?: string): boolean {
    return this.updateObject(id, label, (o) => ({ ...o, components: { ...o.components, ...patch } }), mergeKey);
  }

  /** Removes a component key entirely (e.g. turning physics off). */
  removeComponent(id: string, key: keyof Components, label: string): boolean {
    return this.updateObject(id, label, (o) => {
      if (!(key in o.components)) return o;
      const components = { ...o.components };
      delete components[key];
      return { ...o, components };
    });
  }

  setVisible(id: string, visible: boolean): boolean {
    return this.updateObject(id, visible ? 'Show' : 'Hide', (o) => (o.visible === visible ? o : { ...o, visible }));
  }

  setLocked(id: string, locked: boolean): boolean {
    return this.updateObject(id, locked ? 'Lock' : 'Unlock', (o) => (o.locked === locked ? o : { ...o, locked }));
  }

  moveInHierarchy(id: string, targetId: string | null, position: DropPosition): boolean {
    return this.applySceneChange('Reorder', (s) => moveInHierarchy(s, id, targetId, position));
  }

  /** Puts the selected objects inside a new empty "Group" object. */
  groupSelection(): string | null {
    const ids = topLevelIds(this.scene, this.state.selection);
    if (ids.length === 0) return null;
    const group = createSceneObject('empty', { name: uniqueName(this.scene, 'Group') });
    const first = getObject(this.scene, ids[0] as string);
    group.parentId = first?.parentId ?? null;
    this.applySceneChange(
      'Group',
      (s) => {
        let next = addObjects(s, [group], { index: s.objects.findIndex((o) => o.id === ids[0]) });
        for (const id of ids) next = moveInHierarchy(next, id, group.id, 'inside');
        return next;
      },
      { selection: [group.id] },
    );
    return group.id;
  }

  updateEnvironment(patch: Partial<EnvironmentSettings>, mergeKey?: string): boolean {
    return this.applySceneChange(
      'Change environment',
      (s) => ({ ...s, environment: { ...s.environment, ...patch } }),
      { mergeKey },
    );
  }

  // ── Scripts (document edits are not part of scene undo) ────────────────

  private setProject(project: ProjectBundle): void {
    this.set({ project });
    this.markDirty();
  }

  createScript(name: string, mode: ScriptMode, source?: string): ScriptDoc {
    const taken = Object.values(this.project.scripts).map((s) => s.name);
    let finalName = name.trim() || 'Script';
    let i = 2;
    while (taken.includes(finalName)) finalName = `${name.trim() || 'Script'} ${i++}`;
    const doc = createScriptDoc(finalName, mode, source);
    this.setProject({ ...this.project, scripts: { ...this.project.scripts, [doc.id]: doc } });
    return doc;
  }

  updateScript(id: string, patch: Partial<Omit<ScriptDoc, 'id' | 'createdAt'>>): void {
    const doc = this.project.scripts[id];
    if (!doc) return;
    const next = { ...doc, ...patch, updatedAt: new Date().toISOString() };
    this.setProject({ ...this.project, scripts: { ...this.project.scripts, [id]: next } });
  }

  deleteScript(id: string): void {
    const users = this.objectsUsingScript(id);
    if (users.length) {
      this.applySceneChange('Remove script from objects', (s) =>
        users.reduce(
          (acc, o) =>
            updateObject(acc, o.id, (x) => ({
              ...x,
              components: { ...x.components, scripts: (x.components.scripts ?? []).filter((a) => a.scriptId !== id) },
            })),
          s,
        ),
      );
    }
    const scripts = { ...this.project.scripts };
    delete scripts[id];
    this.setProject({ ...this.project, scripts });
  }

  objectsUsingScript(scriptId: string): SceneObject[] {
    return Object.values(this.project.scenes)
      .flatMap((s) => s.objects)
      .filter((o) => o.components.scripts?.some((a) => a.scriptId === scriptId));
  }

  attachScript(objectId: string, scriptId: string): boolean {
    return this.updateObject(objectId, 'Attach script', (o) => {
      const list = o.components.scripts ?? [];
      if (list.some((a) => a.scriptId === scriptId)) return o;
      return { ...o, components: { ...o.components, scripts: [...list, { scriptId, enabled: true }] } };
    });
  }

  detachScript(objectId: string, scriptId: string): boolean {
    return this.updateObject(objectId, 'Detach script', (o) => ({
      ...o,
      components: { ...o.components, scripts: (o.components.scripts ?? []).filter((a) => a.scriptId !== scriptId) },
    }));
  }

  // ── Assets ─────────────────────────────────────────────────────────────

  async addAsset(meta: AssetMeta, data: ArrayBuffer | null): Promise<void> {
    if (data) await this.options.storage.putAsset(this.project.manifest.id, meta.id, data, meta.mimeType);
    this.setProject({ ...this.project, assets: { ...this.project.assets, [meta.id]: meta } });
    // Persist immediately: binary data is already stored, metadata must follow.
    await this.save();
  }

  renameAsset(id: string, name: string): void {
    const asset = this.project.assets[id];
    const clean = name.trim().slice(0, 96);
    if (!asset || !clean) return;
    this.setProject({ ...this.project, assets: { ...this.project.assets, [id]: { ...asset, name: clean } } });
  }

  objectsUsingAsset(assetId: string): SceneObject[] {
    return Object.values(this.project.scenes)
      .flatMap((s) => s.objects)
      .filter((o) => o.components.model?.assetId === assetId || o.components.material?.mapAssetId === assetId);
  }

  async deleteAsset(id: string): Promise<void> {
    const users = this.objectsUsingAsset(id);
    if (users.length) {
      // Clear texture references; models using the asset are removed from the scene.
      this.applySceneChange('Remove asset from scene', (s) => {
        let next = s;
        for (const o of users) {
          if (o.components.model?.assetId === id) next = removeObjects(next, [o.id]);
          else if (o.components.material?.mapAssetId === id) {
            next = updateObject(next, o.id, (x) => ({
              ...x,
              components: { ...x.components, material: x.components.material && { ...x.components.material, mapAssetId: null } },
            }));
          }
        }
        return next;
      });
    }
    const assets = { ...this.project.assets };
    delete assets[id];
    this.setProject({ ...this.project, assets });
    await this.options.storage.deleteAsset(this.project.manifest.id, id);
  }

  loadAssetData = (assetId: string): Promise<ArrayBuffer | null> =>
    this.options.storage.getAsset(this.project.manifest.id, assetId);

  /** Loads an audio asset by its display name (used by scripts' playSound). */
  loadAssetDataByName = async (name: string): Promise<ArrayBuffer | null> => {
    const asset = Object.values(this.project.assets).find((a) => a.kind === 'audio' && a.name === name);
    return asset ? this.loadAssetData(asset.id) : null;
  };

  // ── Project metadata ───────────────────────────────────────────────────

  updateProjectInfo(patch: { name?: string; description?: string }): void {
    const manifest = { ...this.project.manifest };
    if (patch.name !== undefined && patch.name.trim()) manifest.name = patch.name.trim().slice(0, 64);
    if (patch.description !== undefined) manifest.description = patch.description.slice(0, 500);
    this.setProject({ ...this.project, manifest });
  }

  updateSettings(patch: Partial<ProjectSettings>): void {
    const manifest = { ...this.project.manifest, settings: { ...this.project.manifest.settings, ...patch } };
    this.setProject({ ...this.project, manifest });
  }

  /** The viewport registers itself so saves include a fresh thumbnail. */
  setThumbnailProvider(provider: (() => string | null) | null): void {
    this.thumbnailProvider = provider;
  }

  /** Marks the project as having unsaved changes (e.g. after recovering a draft). */
  markUnsaved(): void {
    this.markDirty();
  }

  setEditorView(position: Vec3, target: Vec3): void {
    this.editorView = { position, target };
  }

  // ── Play state ─────────────────────────────────────────────────────────

  setPlayState(playState: PlayState): void {
    if (playState !== 'edit') this.previewBase = null;
    this.set({ playState });
  }

  // ── Console ────────────────────────────────────────────────────────────

  log(level: ConsoleEntry['level'], message: string, source = 'Editor'): void {
    const entry: ConsoleEntry = { id: ++this.consoleCounter, level, message, source, time: new Date().toISOString() };
    const next = [...this.state.console, entry];
    this.set({ console: next.length > MAX_CONSOLE ? next.slice(-MAX_CONSOLE) : next });
  }

  clearConsole(): void {
    this.set({ console: [] });
  }

  // ── Saving ─────────────────────────────────────────────────────────────

  setAutosave(options: AutosaveOptions): void {
    this.autosave = options;
    if (this.state.saveStatus === 'unsaved') this.scheduleSave();
  }

  private markDirty(): void {
    if (this.state.saveStatus !== 'unsaved') this.set({ saveStatus: 'unsaved' });
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.disposed) return;
    if (this.autosave.enabled) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.save();
      }, this.autosave.delayMs);
    } else {
      // Autosave off: keep a recovery draft so a crash never loses work.
      if (this.draftTimer) clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => {
        this.draftTimer = null;
        void this.options.storage.saveDraft(this.snapshot()).catch(() => {});
      }, 3000);
    }
  }

  /** The project as it should be written to storage. */
  snapshot(): ProjectBundle {
    const project = this.previewBase ? this.withScene(this.state.project, this.previewBase) : this.state.project;
    const scene = project.scenes[this.state.sceneId] as SceneData;
    const withView = this.editorView
      ? this.withScene(project, { ...scene, editorView: { cameraPosition: this.editorView.position, cameraTarget: this.editorView.target } })
      : project;
    return {
      ...withView,
      manifest: {
        ...withView.manifest,
        updatedAt: new Date().toISOString(),
        appVersion: this.options.appVersion ?? withView.manifest.appVersion,
      },
    };
  }

  /** Saves now. Concurrent calls are coalesced. Returns true on success. */
  async save(): Promise<boolean> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.savePromise) {
      this.pendingResave = true;
      return this.savePromise;
    }
    this.savePromise = this.doSave();
    try {
      return await this.savePromise;
    } finally {
      this.savePromise = null;
      if (this.pendingResave && !this.disposed) {
        this.pendingResave = false;
        void this.save();
      }
    }
  }

  private async doSave(): Promise<boolean> {
    const bundle = this.snapshot();
    const savedProject = this.state.project;
    this.set({ saveStatus: 'saving', saveError: null });
    try {
      let thumbnail: string | null | undefined;
      try {
        const provider = this.thumbnailProvider ?? this.options.captureThumbnail;
        thumbnail = provider?.() ?? undefined;
      } catch {
        thumbnail = undefined;
      }
      await this.options.storage.saveProject(bundle, thumbnail === null ? {} : { thumbnail });
      await this.options.storage.clearDraft(bundle.manifest.id).catch(() => {});
      if (Date.now() - this.lastBackupAt > (this.options.backupIntervalMs ?? 5 * 60_000)) {
        this.lastBackupAt = Date.now();
        await this.options.storage.saveBackup(bundle, 'Automatic backup').catch(() => {});
      }
      const changedMeanwhile = this.state.project !== savedProject;
      this.set({
        saveStatus: changedMeanwhile ? 'unsaved' : 'saved',
        lastSavedAt: bundle.manifest.updatedAt,
        project: changedMeanwhile ? this.state.project : { ...this.state.project, manifest: bundle.manifest },
      });
      if (changedMeanwhile) this.scheduleSave();
      return true;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.set({ saveStatus: 'error', saveError: message });
      this.log('error', `Saving failed: ${message}`, 'Storage');
      return false;
    }
  }

  /** Saves pending changes (e.g. before closing the project). */
  async flush(): Promise<void> {
    if (this.state.saveStatus === 'unsaved' || this.saveTimer || this.savePromise) await this.save();
  }

  dispose(): void {
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.listeners.clear();
  }
}
