import {
  CircleAlert,
  Command,
  Download,
  Ellipsis,
  Eye,
  Focus,
  Grid3x3,
  House,
  LogOut,
  Magnet,
  MousePointer2,
  Move3d,
  Package,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Redo2,
  Rotate3d,
  RotateCcw,
  Save,
  Scale3d,
  Square,
  Undo2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/AppController';
import { preferences, usePreferences } from '../../app/preferences';
import { useEditor } from '../../app/services';
import { Menu, MenuItem } from '../../components/feedback';
import { Button, IconButton } from '../../components/ui';
import type { EditorSession, Tool } from '../../editor/EditorSession';
import { relativeTime } from '../../utils/format';
import { ADD_OBJECT_ITEMS, addObject, type ActionDeps } from './editorActions';
import { importAssetsInteractive } from '../assets/importFlow';
import { placeAssetInScene } from '../assets/assetActions';

const TOOLS: { tool: Tool; label: string; icon: typeof Move3d; key: string }[] = [
  { tool: 'select', label: 'Select', icon: MousePointer2, key: 'Q' },
  { tool: 'translate', label: 'Move', icon: Move3d, key: 'W' },
  { tool: 'rotate', label: 'Rotate', icon: Rotate3d, key: 'E' },
  { tool: 'scale', label: 'Scale', icon: Scale3d, key: 'R' },
];

export function Toolbar({
  session,
  deps,
  panels,
  onTogglePanel,
  onOpenPalette,
}: {
  session: EditorSession;
  deps: ActionDeps;
  panels: { hierarchy: boolean; inspector: boolean; bottom: boolean };
  onTogglePanel: (panel: 'hierarchy' | 'inspector' | 'bottom') => void;
  onOpenPalette: () => void;
}) {
  const app = useApp();
  const prefs = usePreferences();
  const beginner = prefs.editorMode === 'beginner';
  const name = useEditor(session, (s) => s.project.manifest.name);
  const saveStatus = useEditor(session, (s) => s.saveStatus);
  const saveError = useEditor(session, (s) => s.saveError);
  const lastSavedAt = useEditor(session, (s) => s.lastSavedAt);
  const tool = useEditor(session, (s) => s.tool);
  const canUndo = useEditor(session, (s) => s.canUndo);
  const canRedo = useEditor(session, (s) => s.canRedo);
  const undoLabel = useEditor(session, (s) => s.undoLabel);
  const redoLabel = useEditor(session, (s) => s.redoLabel);
  const playState = useEditor(session, (s) => s.playState);
  const modelAssets = useEditor(session, (s) => s.project.assets);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<HTMLElement | null>(null);
  const playing = playState !== 'edit';
  const starting = playState === 'starting';

  const statusText =
    saveStatus === 'saved'
      ? `Saved ${lastSavedAt ? relativeTime(lastSavedAt) : ''}`
      : saveStatus === 'saving'
        ? 'Saving…'
        : saveStatus === 'unsaved'
          ? 'Unsaved changes'
          : 'Save failed — tap to retry';

  const models = Object.values(modelAssets).filter((a) => a.kind === 'model' || a.kind === 'prefab');

  return (
    <header className="toolbar" aria-label="Editor toolbar">
      <div className="toolbar-group">
        <IconButton icon={House} label="Home" tooltip="Back to Home" showLabel={beginner} onClick={() => app.navigate('home')} />
        <div className="project-title">
          <strong title={name}>{name}</strong>
          <button
            type="button"
            className="save-status"
            data-status={saveStatus}
            data-testid="save-status"
            title={saveError ?? 'Save now'}
            onClick={() => void session.save()}
          >
            {saveStatus === 'error' ? <CircleAlert size={13} aria-hidden="true" /> : <span className="dot" aria-hidden="true" />}
            {statusText}
          </button>
        </div>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <IconButton
          icon={Undo2}
          label="Undo"
          tooltip={undoLabel ? `Undo ${undoLabel} (⌘Z)` : 'Nothing to undo'}
          showLabel={beginner}
          disabled={!canUndo || playing}
          onClick={() => session.undo()}
        />
        <IconButton
          icon={Redo2}
          label="Redo"
          tooltip={redoLabel ? `Redo ${redoLabel} (⇧⌘Z)` : 'Nothing to redo'}
          showLabel={beginner}
          disabled={!canRedo || playing}
          onClick={() => session.redo()}
        />
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group" role="group" aria-label="Transform tools">
        {TOOLS.map((t) => (
          <IconButton
            key={t.tool}
            icon={t.icon}
            label={t.label}
            tooltip={`${t.label} (${t.key})`}
            showLabel={beginner}
            active={tool === t.tool}
            disabled={playing}
            onClick={() => session.setTool(t.tool)}
          />
        ))}
      </div>
      <div className="toolbar-sep" />
      <Button variant="primary" icon={Plus} onClick={(e) => setAddMenu(e.currentTarget)} disabled={playing} aria-haspopup="menu">
        Add
      </Button>
      <div className="spacer" />
      <div className="toolbar-group">
        {starting ? (
          <Button variant="play" icon={Play} disabled data-testid="play-button">
            Starting…
          </Button>
        ) : playing ? (
          <Button variant="stop" icon={Square} onClick={deps.play.stop} data-testid="stop-button">
            Stop
          </Button>
        ) : (
          <Button variant="play" icon={Play} onClick={() => void deps.play.start()} data-testid="play-button">
            Play
          </Button>
        )}
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <IconButton icon={Eye} label="View" tooltip="View options" showLabel={beginner} onClick={(e) => setViewMenu(e.currentTarget)} />
        <IconButton icon={PanelLeft} label="Objects" tooltip="Show/hide object list" showLabel={beginner} active={panels.hierarchy} onClick={() => onTogglePanel('hierarchy')} />
        <IconButton icon={PanelRight} label="Inspector" tooltip="Show/hide inspector" showLabel={beginner} active={panels.inspector} onClick={() => onTogglePanel('inspector')} />
        <IconButton icon={PanelBottom} label="Panel" tooltip="Show/hide assets & console" showLabel={beginner} active={panels.bottom} onClick={() => onTogglePanel('bottom')} />
        <IconButton icon={Command} label="Search" tooltip="Search actions (⌘K)" showLabel={beginner} onClick={onOpenPalette} />
        <IconButton icon={Ellipsis} label="More" tooltip="More" showLabel={beginner} onClick={(e) => setMoreMenu(e.currentTarget)} />
      </div>

      {addMenu && (
        <Menu anchor={addMenu} label="Add object" onClose={() => setAddMenu(null)}>
          {['Shapes', 'Lights', 'Other'].map((group) => (
            <div key={group}>
              <div className="menu-heading">{group}</div>
              {ADD_OBJECT_ITEMS.filter((i) => i.group === group).map((item) => (
                <MenuItem key={item.type} icon={item.icon} label={item.label} hint={beginner ? item.description : undefined} onSelect={() => addObject(deps, item.type)} />
              ))}
            </div>
          ))}
          <div className="menu-heading">Models</div>
          {models.slice(0, 8).map((m) => (
            <MenuItem
              key={m.id}
              icon={Package}
              label={m.name}
              onSelect={() => placeAssetInScene(session, m, deps.viewport?.getSpawnPoint())}
            />
          ))}
          <MenuItem icon={Upload} label="Import a model…" onSelect={() => void importAssetsInteractive(session, deps.toast, '.glb,.gltf')} />
        </Menu>
      )}
      {viewMenu && (
        <Menu anchor={viewMenu} label="View options" align="end" onClose={() => setViewMenu(null)}>
          <MenuItem icon={Focus} label="Focus on selection" hint="F" onSelect={() => deps.viewport?.frameSelection()} />
          <MenuItem icon={RotateCcw} label="Reset camera" onSelect={() => deps.viewport?.resetView()} />
          <div className="menu-sep" />
          <MenuItem
            icon={Grid3x3}
            label={prefs.showGrid ? 'Hide grid' : 'Show grid'}
            onSelect={() => preferences.update((p) => ({ showGrid: !p.showGrid }))}
          />
          <MenuItem
            icon={Magnet}
            label={prefs.snapping.enabled ? 'Turn snapping off' : 'Turn snapping on'}
            hint={`${prefs.snapping.translate} / ${prefs.snapping.rotate}°`}
            onSelect={() => preferences.update((p) => ({ snapping: { ...p.snapping, enabled: !p.snapping.enabled } }))}
          />
          {!beginner && (
            <>
              <MenuItem
                icon={Eye}
                label={prefs.showColliders ? 'Hide colliders' : 'Show colliders'}
                onSelect={() => preferences.update((p) => ({ showColliders: !p.showColliders }))}
              />
              <MenuItem
                icon={Move3d}
                label={session.getState().space === 'world' ? 'Use local axes' : 'Use world axes'}
                onSelect={() => session.setSpace(session.getState().space === 'world' ? 'local' : 'world')}
              />
            </>
          )}
        </Menu>
      )}
      {moreMenu && (
        <Menu anchor={moreMenu} label="More" align="end" onClose={() => setMoreMenu(null)}>
          <MenuItem icon={Save} label="Save now" hint="⌘S" onSelect={() => void session.save()} />
          <MenuItem icon={Download} label="Export project (.zip)" onSelect={() => void app.exportProject()} />
          <MenuItem icon={Upload} label="Import assets…" onSelect={() => void importAssetsInteractive(session, deps.toast)} />
          <div className="menu-sep" />
          <MenuItem icon={LogOut} label="Close project" onSelect={() => void app.closeProject()} />
        </Menu>
      )}
    </header>
  );
}
