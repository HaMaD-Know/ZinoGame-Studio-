import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppController';
import { preferences, usePreferences } from '../../app/preferences';
import { useEditor, useSession } from '../../app/services';
import { useConfirm, useToast } from '../../components/feedback';
import { disposeAssetCache } from '../../editor/assetCacheRegistry';
import type { EditorViewport } from '../../engine/editor-viewport/EditorViewport';
import { HierarchyPanel } from '../hierarchy/HierarchyPanel';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { PlayOverlay } from '../play-mode/PlayOverlay';
import { usePlayController } from '../play-mode/usePlayController';
import { GuidePanel } from '../tutorials/GuidePanel';
import { BottomPanel } from './BottomPanel';
import { CommandPalette } from './CommandPalette';
import { buildEditorActions, type ActionDeps } from './editorActions';
import { Toolbar } from './Toolbar';
import { useEditorShortcuts } from './useEditorShortcuts';
import { ViewportPanel } from './ViewportPanel';

function useMediaQuery(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const COMPACT_QUERY = '(max-width: 1100px), (orientation: portrait) and (max-width: 1366px)';

/** The Create area: toolbar, hierarchy, 3D viewport, inspector and bottom panel. */
export function EditorWorkspace({ hidden }: { hidden: boolean }) {
  const session = useSession();
  const app = useApp();
  const prefs = usePreferences();
  const toast = useToast();
  const confirm = useConfirm();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [viewport, setViewport] = useState<EditorViewport | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  // On compact screens panels are drawers that start closed.
  const [drawers, setDrawers] = useState({ hierarchy: false, inspector: false, bottom: false });
  const playing = useEditor(session, (s) => s.playState === 'playing');
  const selectionLength = useEditor(session, (s) => s.selection.length);
  const showScore = useEditor(session, (s) => s.project.manifest.settings.showScore);

  const play = usePlayController(session, viewport, () => setHasPlayed(true));
  const deps: ActionDeps = useMemo(() => ({ session, viewport, confirm, toast, play }), [session, viewport, confirm, toast, play]);
  const actions = useMemo(() => buildEditorActions(deps), [deps]);

  useEffect(() => () => disposeAssetCache(session), [session]);
  useEffect(() => {
    if (hidden && play.playing) play.stop();
  }, [hidden, play]);

  const panels = compact ? drawers : prefs.panels;
  const togglePanel = useCallback(
    (panel: 'hierarchy' | 'inspector' | 'bottom') => {
      if (compact) {
        setDrawers((d) => ({
          hierarchy: panel === 'hierarchy' ? !d.hierarchy : panel === 'inspector' ? false : d.hierarchy,
          inspector: panel === 'inspector' ? !d.inspector : panel === 'hierarchy' ? false : d.inspector,
          bottom: panel === 'bottom' ? !d.bottom : d.bottom,
        }));
      } else {
        preferences.update((p) => ({ panels: { ...p.panels, [panel]: !p.panels[panel] } }));
      }
    },
    [compact],
  );

  // On compact screens, open the inspector automatically when something is selected from the 3D view.
  useEffect(() => {
    if (compact && selectionLength > 0 && !drawers.hierarchy) setDrawers((d) => ({ ...d, inspector: true }));
    // Only react to selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionLength]);

  useEditorShortcuts(session, deps, !hidden, { openPalette: () => setPaletteOpen(true) });

  return (
    <div className="workspace" hidden={hidden} data-testid="editor-workspace">
      <Toolbar session={session} deps={deps} panels={panels} onTogglePanel={togglePanel} onOpenPalette={() => setPaletteOpen(true)} />
      <div className="workspace-body">
        <aside className="side-panel left" data-collapsed={!panels.hierarchy || playing} aria-label="Objects">
          <HierarchyPanel session={session} deps={deps} onFocus={(id) => viewport?.frameSelection([id])} />
        </aside>
        <div className="viewport-area">
          <ViewportPanel session={session} hidden={hidden} onViewport={setViewport} />
          {playing && <PlayOverlay play={play} showScore={showScore} />}
          {!playing && play.fatal && (
            <div className="viewport-hud">
              <div className="banner banner-danger" role="alert">
                {play.fatal}
              </div>
            </div>
          )}
          {app.activeTutorial && !playing && (
            <GuidePanel session={session} tutorialId={app.activeTutorial} hasPlayed={hasPlayed} onClose={() => app.setActiveTutorial(null)} />
          )}
        </div>
        <aside className="side-panel right" data-collapsed={!panels.inspector || playing} aria-label="Inspector">
          <InspectorPanel session={session} deps={deps} />
        </aside>
        <section className="bottom-panel" data-collapsed={!panels.bottom || playing} aria-label="Assets and console">
          <BottomPanel session={session} viewport={viewport} />
        </section>
      </div>
      {paletteOpen && <CommandPalette actions={actions} session={session} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
