import {
  ArchiveRestore,
  Box,
  Download,
  Ellipsis,
  FolderOpen,
  GraduationCap,
  LifeBuoy,
  Plus,
  Rocket,
  Trash,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppController';
import { useServices } from '../../app/services';
import { Menu, MenuItem, useConfirm, useToast } from '../../components/feedback';
import { Button, EmptyState, IconButton } from '../../components/ui';
import { EXAMPLE_PROJECTS } from '../../engine/project/templates';
import type { ProjectSummary } from '../../engine/project/types';
import type { DraftInfo } from '../../engine/storage/ProjectStorage';
import { pluralize, relativeTime } from '../../utils/format';
import { TUTORIALS } from '../tutorials/tutorials';
import { NewProjectDialog } from './NewProjectDialog';

export function HomePage() {
  const app = useApp();
  const { storage, persistent } = useServices();
  const toast = useToast();
  const confirm = useConfirm();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; project: ProjectSummary } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([storage.listProjects(), storage.listDrafts()])
      .then(([list, d]) => {
        if (cancelled) return;
        setProjects(list);
        const byId = new Map(list.map((p) => [p.id, p]));
        setDrafts(d.filter((x) => !byId.has(x.projectId) || x.savedAt > (byId.get(x.projectId)?.updatedAt ?? '')));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProjects([]);
          setLoadError((err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storage, app.projectsVersion]);

  const recoverDraft = async (draft: DraftInfo) => {
    const d = await storage.loadDraft(draft.projectId);
    if (!d) {
      toast({ tone: 'error', title: 'The recovery copy could not be read' });
      return;
    }
    await app.openBundle(d.bundle, { unsaved: true });
    toast({ tone: 'success', title: 'Unsaved changes recovered', description: 'Save to keep them.' });
  };

  const deleteProject = async (p: ProjectSummary) => {
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      message: 'This removes the project, its assets and backups from this device. Export it first if you want to keep a copy.',
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    if (app.session?.project.manifest.id === p.id) await app.closeProject();
    await storage.deleteProject(p.id);
    app.refreshProjects();
    toast({ tone: 'success', title: 'Project deleted' });
  };

  const restoreBackup = async (p: ProjectSummary) => {
    const backups = await storage.listBackups(p.id);
    if (backups.length === 0) {
      toast({ tone: 'info', title: 'No backups yet', description: 'Backups are made when you open a project and every few minutes while editing.' });
      return;
    }
    const latest = backups[0]!;
    const ok = await confirm({
      title: 'Restore backup?',
      message: `Restore "${p.name}" to the backup from ${new Date(latest.createdAt).toLocaleString()} (${latest.reason})? The current version will be kept as another backup.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    if (app.session?.project.manifest.id === p.id) await app.closeProject();
    const current = await storage.loadProject(p.id).catch(() => null);
    if (current) await storage.saveBackup(current.bundle, 'Before restoring a backup');
    const restored = await storage.loadBackup(latest.id);
    await storage.saveProject(restored.bundle);
    app.refreshProjects();
    toast({ tone: 'success', title: 'Backup restored' });
  };

  return (
    <div className="page">
      <div className="page-inner">
        <section className="hero" aria-label="Welcome">
          <img src="./icons/icon-192.png" alt="" />
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1>ZinoGame Studio</h1>
            <p>Build 3D worlds and games right on your iPad. Start with a baseplate, add objects, snap together scripts and press Play.</p>
            <div className="row row-wrap" style={{ marginTop: 16 }}>
              <Button variant="primary" size="lg" icon={Plus} onClick={() => setCreating(true)}>
                Create Project
              </Button>
              <Button size="lg" icon={Upload} className="btn-secondary-on-dark" onClick={() => void app.importProject()}>
                Import Project
              </Button>
            </div>
          </div>
        </section>

        {!persistent && (
          <div className="banner banner-warning" role="alert">
            <LifeBuoy size={20} aria-hidden="true" />
            <div>
              <strong>Saving is not available in this browser mode.</strong>
              <p className="small">Projects will be lost when you close the app. Use Export to keep a copy, or leave private browsing.</p>
            </div>
          </div>
        )}
        {loadError && (
          <div className="banner banner-danger" role="alert">
            Your projects could not be loaded: {loadError}
          </div>
        )}

        {drafts.length > 0 && (
          <section aria-labelledby="recovery-title">
            <h2 className="section-title" id="recovery-title">
              <ArchiveRestore size={20} aria-hidden="true" /> Recover unsaved work
            </h2>
            <div className="stack">
              {drafts.map((d) => (
                <div key={d.projectId} className="banner">
                  <div style={{ flex: 1 }}>
                    <strong>{d.name}</strong>
                    <p className="small muted">Unsaved changes from {relativeTime(d.savedAt)} were kept safe.</p>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => void recoverDraft(d)}>
                    Recover
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void storage.clearDraft(d.projectId).then(app.refreshProjects);
                    }}
                  >
                    Discard
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="recent-title">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h2 className="section-title" id="recent-title" style={{ margin: 0 }}>
              <FolderOpen size={20} aria-hidden="true" /> Your projects
            </h2>
            {app.session && (
              <Button size="sm" onClick={() => app.navigate('create')}>
                Back to {app.session.project.manifest.name}
              </Button>
            )}
          </div>
          {projects === null ? null : projects.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Box}
                title="No projects yet"
                action={
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    Create your first project
                  </Button>
                }
              >
                Your games will appear here. Start with an Empty Baseplate — it is the easiest way to begin.
              </EmptyState>
            </div>
          ) : (
            <div className="grid-cards">
              {projects.map((p) => (
                <div key={p.id} className="card project-card" style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => void app.openProject(p.id)}
                    aria-label={`Open ${p.name}`}
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                  >
                    <div className="project-thumb">
                      {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Box size={36} aria-hidden="true" />}
                    </div>
                    <div className="project-meta">
                      <strong>{p.name}</strong>
                      <span className="small muted">
                        Edited {relativeTime(p.updatedAt)} · {pluralize(p.objectCount, 'object')}
                      </span>
                    </div>
                  </button>
                  <div style={{ position: 'absolute', top: 8, right: 8 }}>
                    <IconButton
                      icon={Ellipsis}
                      label={`More actions for ${p.name}`}
                      size="sm"
                      style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}
                      onClick={(e) => setMenu({ anchor: e.currentTarget, project: p })}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="examples-title">
          <h2 className="section-title" id="examples-title">
            <Rocket size={20} aria-hidden="true" /> Example projects
          </h2>
          <div className="grid-cards">
            {EXAMPLE_PROJECTS.map((e) => (
              <button key={e.id} type="button" className="card card-pad tutorial-card" onClick={() => void app.openExample(e.id)}>
                <div className="num" aria-hidden="true">
                  <Rocket size={18} />
                </div>
                <div>
                  <strong>{e.name}</strong>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {e.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="tutorials-title">
          <h2 className="section-title" id="tutorials-title">
            <GraduationCap size={20} aria-hidden="true" /> Beginner tutorials
          </h2>
          <div className="grid-cards">
            {TUTORIALS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className="card card-pad tutorial-card"
                onClick={async () => {
                  if (!app.session) {
                    await app.createProject({ name: `Tutorial – ${t.title}`, template: 'empty-baseplate' });
                  } else {
                    app.navigate('create');
                  }
                  app.setActiveTutorial(t.id);
                }}
              >
                <div className="num" aria-hidden="true">
                  {i + 1}
                </div>
                <div>
                  <strong>{t.title}</strong>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {t.summary}
                  </p>
                  <span className="chip" style={{ marginTop: 8 }}>
                    About {t.minutes} min · {t.steps.length} steps
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {creating && (
        <NewProjectDialog
          existingNames={(projects ?? []).map((p) => p.name)}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            await app.createProject(input);
            setCreating(false);
          }}
        />
      )}
      {menu && (
        <Menu anchor={menu.anchor} label="Project actions" align="end" onClose={() => setMenu(null)}>
          <MenuItem icon={FolderOpen} label="Open" onSelect={() => void app.openProject(menu.project.id)} />
          <MenuItem icon={Download} label="Export (.zip)" onSelect={() => void app.exportProject(menu.project.id)} />
          <MenuItem icon={ArchiveRestore} label="Restore latest backup" onSelect={() => void restoreBackup(menu.project)} />
          <div className="menu-sep" />
          <MenuItem icon={Trash} label="Delete…" danger onSelect={() => void deleteProject(menu.project)} />
        </Menu>
      )}
    </div>
  );
}
