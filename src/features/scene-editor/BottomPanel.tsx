import { Blocks, CircleAlert, Info, Package, Terminal, TriangleAlert, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppController';
import { usePreferences } from '../../app/preferences';
import { useEditor } from '../../app/services';
import { Button, EmptyState, Tabs } from '../../components/ui';
import type { EditorSession } from '../../editor/EditorSession';
import { compileScriptDoc } from '../../engine/scripting/scriptDoc';
import { placeAssetInScene } from '../assets/assetActions';
import type { EditorViewport } from '../../engine/editor-viewport/EditorViewport';

type BottomTab = 'assets' | 'console' | 'problems';

export function BottomPanel({ session, viewport }: { session: EditorSession; viewport: EditorViewport | null }) {
  const app = useApp();
  const prefs = usePreferences();
  const [tab, setTab] = useState<BottomTab>('assets');
  const consoleEntries = useEditor(session, (s) => s.console);
  const scripts = useEditor(session, (s) => s.project.scripts);
  const assets = useEditor(session, (s) => s.project.assets);

  const problems = useMemo(
    () =>
      Object.values(scripts).flatMap((doc) =>
        compileScriptDoc(doc).diagnostics.map((d) => ({ ...d, scriptId: doc.id, scriptName: doc.name })),
      ),
    [scripts],
  );
  const errors = consoleEntries.filter((e) => e.level === 'error').length;
  const placeable = Object.values(assets).filter((a) => a.kind === 'model' || a.kind === 'prefab');

  return (
    <>
      <Tabs<BottomTab>
        label="Bottom panel"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'assets', label: 'Assets', icon: Blocks },
          {
            id: 'console',
            label: prefs.editorMode === 'beginner' ? 'Messages' : 'Console',
            icon: Terminal,
            badge: errors ? <span className="badge badge-danger">{errors}</span> : null,
          },
          {
            id: 'problems',
            label: 'Script problems',
            icon: CircleAlert,
            badge: problems.length ? <span className="badge badge-warning">{problems.length}</span> : null,
          },
        ]}
      />
      <div className="bottom-panel-body">
        {tab === 'assets' &&
          (placeable.length === 0 ? (
            <EmptyState icon={Package} title="No models yet" action={<Button onClick={() => app.navigate('assets')}>Open Assets</Button>}>
              Import .glb models or save prefabs in the Assets area, then place them here with one tap.
            </EmptyState>
          ) : (
            <div className="row row-wrap" style={{ padding: 12 }}>
              {placeable.map((a) => (
                <Button key={a.id} icon={Package} onClick={() => placeAssetInScene(session, a, viewport?.getSpawnPoint())}>
                  {a.name}
                </Button>
              ))}
            </div>
          ))}
        {tab === 'console' && (
          <>
            <div className="row" style={{ padding: '6px 12px' }}>
              <span className="small muted">{consoleEntries.length} messages</span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={Trash} onClick={() => session.clearConsole()} disabled={!consoleEntries.length}>
                Clear
              </Button>
            </div>
            {consoleEntries.length === 0 ? (
              <EmptyState icon={Terminal} title="No messages">
                Messages from your scripts (log) and the editor appear here.
              </EmptyState>
            ) : (
              <ul className="console-list" aria-live="polite">
                {[...consoleEntries].reverse().map((e) => (
                  <li key={e.id} data-level={e.level}>
                    <span className="time">{new Date(e.time).toLocaleTimeString()}</span>
                    <span className="source">{e.source}</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {tab === 'problems' &&
          (problems.length === 0 ? (
            <EmptyState icon={CircleAlert} title="No problems">
              All scripts look good.
            </EmptyState>
          ) : (
            <div>
              {problems.map((p, i) => {
                const Icon = p.severity === 'error' ? CircleAlert : p.severity === 'warning' ? TriangleAlert : Info;
                return (
                  <button key={i} type="button" className="diag-item" onClick={() => app.openScript(p.scriptId)}>
                    <Icon size={16} className={`diag-icon-${p.severity}`} aria-hidden="true" />
                    <span>
                      <strong>{p.scriptName}</strong>
                      {p.loc ? ` · line ${p.loc.line}` : ''}: {p.message}
                      {p.hint && <span className="small muted"> — {p.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </>
  );
}
