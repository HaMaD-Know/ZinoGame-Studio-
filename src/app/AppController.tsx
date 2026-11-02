import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorSession } from '../editor/EditorSession';
import { createExampleProject, createProjectFromTemplate, type CreateProjectInput } from '../engine/project/templates';
import type { ProjectBundle } from '../engine/project/types';
import { ArchiveError, exportProjectArchive, importProjectArchive } from '../engine/serialization/projectArchive';
import { ProjectLoadError } from '../engine/storage/ProjectStorage';
import { onAppBackground, pickFiles, saveFileForUser } from '../platform/platform';
import { useConfirm, useToast } from '../components/feedback';
import { preferences, usePreferences } from './preferences';
import { APP_VERSION, SessionProvider, useServices } from './services';
import type { TutorialId } from '../features/tutorials/tutorials';

export type Route = 'home' | 'create' | 'assets' | 'scripts' | 'settings';

export interface AppController {
  route: Route;
  navigate: (route: Route) => void;
  session: EditorSession | null;
  activeTutorial: TutorialId | null;
  setActiveTutorial: (id: TutorialId | null) => void;
  createProject: (input: CreateProjectInput) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  openExample: (exampleId: string) => Promise<void>;
  openBundle: (bundle: ProjectBundle, options?: { unsaved?: boolean; warnings?: string[] }) => Promise<void>;
  closeProject: () => Promise<void>;
  exportProject: (projectId?: string) => Promise<void>;
  importProject: () => Promise<void>;
  /** Script the Scripts page should show next (set by "Edit" buttons elsewhere). */
  scriptToOpen: string | null;
  openScript: (scriptId: string) => void;
  /** Bumped whenever the project list changes, so Home can refresh. */
  projectsVersion: number;
  refreshProjects: () => void;
}

const Ctx = createContext<AppController | null>(null);

export function useApp(): AppController {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside AppControllerProvider');
  return c;
}

export function AppControllerProvider({ children }: { children: ReactNode }) {
  const { storage } = useServices();
  const toast = useToast();
  const confirm = useConfirm();
  const prefs = usePreferences();
  const [route, setRoute] = useState<Route>('home');
  const [session, setSession] = useState<EditorSession | null>(null);
  const [projectsVersion, setProjectsVersion] = useState(0);
  const [activeTutorial, setActiveTutorial] = useState<TutorialId | null>(null);
  const [scriptToOpen, setScriptToOpen] = useState<string | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  sessionRef.current = session;

  const refreshProjects = useCallback(() => setProjectsVersion((v) => v + 1), []);

  // Keep autosave settings in sync with preferences.
  useEffect(() => {
    session?.setAutosave({ enabled: prefs.autosave.enabled, delayMs: prefs.autosave.delaySeconds * 1000 });
  }, [session, prefs.autosave.enabled, prefs.autosave.delaySeconds]);

  // Save when the app is backgrounded (iPad home gesture, tab hidden).
  useEffect(() => {
    let remove: (() => void) | null = null;
    void onAppBackground(() => {
      const s = sessionRef.current;
      if (s && s.getState().saveStatus !== 'saved') void s.save();
    }).then((r) => (remove = r));
    return () => remove?.();
  }, []);

  const closeProject = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      await s.flush();
    } catch {
      // Errors are reported through the session console; we still close.
    }
    s.dispose();
    setSession(null);
    setActiveTutorial(null);
    setRoute('home');
    refreshProjects();
  }, [refreshProjects]);

  const openBundle = useCallback(
    async (bundle: ProjectBundle, options: { unsaved?: boolean; warnings?: string[] } = {}) => {
      const previous = sessionRef.current;
      if (previous) {
        await previous.flush().catch(() => {});
        previous.dispose();
      }
      const p = preferences.get();
      const next = new EditorSession(bundle, {
        storage,
        appVersion: APP_VERSION,
        autosave: { enabled: p.autosave.enabled, delayMs: p.autosave.delaySeconds * 1000 },
      });
      for (const w of options.warnings ?? []) next.log('warn', w, 'Project');
      if (options.unsaved) next.markUnsaved();
      // A backup of what was opened makes "undo everything" possible later.
      void storage.saveBackup(bundle, 'Opened project').catch(() => {});
      setSession(next);
      setRoute('create');
      if (options.warnings?.length) {
        toast({
          tone: 'warning',
          title: 'Project opened with repairs',
          description: `${options.warnings.length} problem(s) were fixed automatically. See the Console for details.`,
        });
      }
    },
    [storage, toast],
  );

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const bundle = createProjectFromTemplate({ ...input, appVersion: APP_VERSION });
      await storage.saveProject(bundle);
      refreshProjects();
      await openBundle(bundle);
    },
    [storage, openBundle, refreshProjects],
  );

  const openExample = useCallback(
    async (exampleId: string) => {
      const bundle = createExampleProject(exampleId, APP_VERSION);
      await storage.saveProject(bundle);
      refreshProjects();
      await openBundle(bundle);
      toast({ tone: 'success', title: `${bundle.manifest.name} is ready`, description: 'Press Play to try it!' });
    },
    [storage, openBundle, refreshProjects, toast],
  );

  const openProject = useCallback(
    async (id: string) => {
      try {
        const { bundle, warnings } = await storage.loadProject(id);
        await openBundle(bundle, { warnings });
      } catch (err) {
        if (err instanceof ProjectLoadError && err.hasBackups) {
          const restore = await confirm({
            title: 'This project could not be opened',
            message: `${err.message}\n\nA backup is available. Do you want to restore the most recent backup?`,
            confirmLabel: 'Restore backup',
          });
          if (!restore) return;
          const [latest] = await storage.listBackups(id);
          if (!latest) return;
          const restored = await storage.loadBackup(latest.id);
          await storage.saveProject(restored.bundle);
          refreshProjects();
          await openBundle(restored.bundle, { warnings: restored.warnings });
          toast({ tone: 'success', title: 'Backup restored', description: `From ${new Date(latest.createdAt).toLocaleString()}` });
          return;
        }
        toast({ tone: 'error', title: 'Could not open project', description: (err as Error).message });
      }
    },
    [storage, openBundle, confirm, refreshProjects, toast],
  );

  const exportProject = useCallback(
    async (projectId?: string) => {
      try {
        const s = sessionRef.current;
        let bundle: ProjectBundle;
        if (s && (!projectId || projectId === s.project.manifest.id)) {
          await s.flush();
          bundle = s.snapshot();
        } else if (projectId) {
          bundle = (await storage.loadProject(projectId)).bundle;
        } else {
          return;
        }
        const id = bundle.manifest.id;
        const archive = await exportProjectArchive(bundle, (assetId) => storage.getAsset(id, assetId));
        const result = await saveFileForUser(archive.fileName, archive.data, 'application/zip');
        toast({
          tone: archive.missingAssets.length ? 'warning' : 'success',
          title: 'Project exported',
          description: archive.missingAssets.length
            ? `Saved to ${result.location}. Missing asset files: ${archive.missingAssets.join(', ')}`
            : `Saved to ${result.location}`,
        });
      } catch (err) {
        toast({ tone: 'error', title: 'Export failed', description: (err as Error).message });
      }
    },
    [storage, toast],
  );

  const importProject = useCallback(async () => {
    const [file] = await pickFiles('.zip,.zinoproj,application/zip');
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      let imported = importProjectArchive(data);
      const existing = await storage.listProjects();
      if (existing.some((p) => p.id === imported.bundle.manifest.id)) {
        const replace = await confirm({
          title: 'Project already exists',
          message: `"${imported.bundle.manifest.name}" is already on this device. Import it as a separate copy, or replace the existing project?`,
          confirmLabel: 'Import as copy',
          cancelLabel: 'Replace existing',
        });
        if (replace) {
          imported = importProjectArchive(data, { newId: true });
          imported.bundle.manifest.name = `${imported.bundle.manifest.name} (copy)`.slice(0, 64);
        }
      }
      const id = imported.bundle.manifest.id;
      for (const [assetId, asset] of imported.assets) await storage.putAsset(id, assetId, asset.data, asset.mimeType);
      await storage.saveProject(imported.bundle);
      refreshProjects();
      await openBundle(imported.bundle, { warnings: imported.warnings });
      toast({ tone: 'success', title: 'Project imported', description: imported.bundle.manifest.name });
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Import failed',
        description: err instanceof ArchiveError ? err.message : `This file could not be imported: ${(err as Error).message}`,
      });
    }
  }, [storage, confirm, openBundle, refreshProjects, toast]);

  const navigate = useCallback((r: Route) => setRoute(r), []);
  const openScript = useCallback((scriptId: string) => {
    setScriptToOpen(scriptId);
    setRoute('scripts');
  }, []);

  const value = useMemo<AppController>(
    () => ({
      route,
      navigate,
      session,
      activeTutorial,
      setActiveTutorial,
      createProject,
      openProject,
      openExample,
      openBundle,
      closeProject,
      exportProject,
      importProject,
      scriptToOpen,
      openScript,
      projectsVersion,
      refreshProjects,
    }),
    [route, navigate, session, activeTutorial, createProject, openProject, openExample, openBundle, closeProject, exportProject, importProject, scriptToOpen, openScript, projectsVersion, refreshProjects],
  );

  return (
    <Ctx.Provider value={value}>
      <SessionProvider session={session}>{children}</SessionProvider>
    </Ctx.Provider>
  );
}
