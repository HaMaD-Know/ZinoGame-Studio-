import {
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Ellipsis,
  Eye,
  EyeOff,
  Focus,
  GripVertical,
  Group,
  ListChecks,
  Lock,
  LockOpen,
  Pencil,
  Trash,
  Ungroup,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { useEditor } from '../../app/services';
import { Menu, MenuItem } from '../../components/feedback';
import { EnvironmentIcon, ObjectIcon } from '../../components/icons';
import { EmptyState, IconButton, SearchInput } from '../../components/ui';
import type { EditorSession } from '../../editor/EditorSession';
import { flattenHierarchy, type DropPosition } from '../../engine/scene/sceneOps';
import type { SceneObject } from '../../engine/scene/types';
import { deleteSelection, type ActionDeps } from '../scene-editor/editorActions';

interface DragState {
  id: string;
  pointerId: number;
  target: { id: string; position: DropPosition } | null;
}

export function HierarchyPanel({ session, deps, onFocus }: { session: EditorSession; deps: ActionDeps; onFocus: (id: string) => void }) {
  const prefs = usePreferences();
  const advanced = prefs.editorMode === 'advanced';
  const scene = useEditor(session, (s) => s.project.scenes[s.sceneId]);
  const selection = useEditor(session, (s) => s.selection);
  const envSelected = useEditor(session, (s) => s.environmentSelected);
  const playing = useEditor(session, (s) => s.playState !== 'edit');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; obj: SceneObject } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Touch screens have no Shift/⌘ key, so multi-select is a toggle.
  const [multi, setMulti] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    if (!scene) return [];
    const flat = flattenHierarchy(scene);
    const childCount = new Map<string, number>();
    for (const o of scene.objects) if (o.parentId) childCount.set(o.parentId, (childCount.get(o.parentId) ?? 0) + 1);
    const q = query.trim().toLowerCase();
    if (q) {
      return flat
        .filter((r) => r.object.name.toLowerCase().includes(q) || r.object.type.toLowerCase().includes(q))
        .map((r) => ({ ...r, depth: 0, children: 0 }));
    }
    const hiddenAncestors = new Set<string>();
    const out: { object: SceneObject; depth: number; children: number }[] = [];
    for (const r of flat) {
      if (r.object.parentId && hiddenAncestors.has(r.object.parentId)) {
        hiddenAncestors.add(r.object.id);
        continue;
      }
      if (collapsed.has(r.object.id)) hiddenAncestors.add(r.object.id);
      out.push({ ...r, children: childCount.get(r.object.id) ?? 0 });
    }
    return out;
  }, [scene, query, collapsed]);

  if (!scene) return null;

  const toggleCollapse = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Pointer-based drag (HTML5 drag-and-drop does not work with touch on iPad).
  const updateDropTarget = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-row-id]');
    if (!el || !drag) return;
    const targetId = el.dataset.rowId as string;
    if (targetId === drag.id) {
      setDrag({ ...drag, target: null });
      return;
    }
    const rect = el.getBoundingClientRect();
    const y = (clientY - rect.top) / rect.height;
    const position: DropPosition = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    setDrag({ ...drag, target: { id: targetId, position } });
  };

  return (
    <>
      <div className="panel-header">
        <h2>Objects</h2>
        <span className="chip">{scene.objects.length}</span>
        <IconButton
          icon={ListChecks}
          label={multi ? 'Stop selecting several' : 'Select several'}
          size="sm"
          active={multi}
          onClick={() => setMulti((m) => !m)}
        />
      </div>
      <div style={{ padding: '10px 10px 4px' }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search objects" label="Search objects" />
      </div>
      <div className="panel-scroll">
        <ul className="tree" ref={listRef} role="tree" aria-label="Scene objects" aria-multiselectable="true">
          <li role="none" className="tree-env-row">
            <div
              className="tree-row"
              role="treeitem"
              aria-selected={envSelected}
              tabIndex={0}
              onClick={() => session.selectEnvironment()}
              onKeyDown={(e) => e.key === 'Enter' && session.selectEnvironment()}
              style={{ paddingLeft: 30 }}
            >
              <EnvironmentIcon size={18} className="tree-icon" aria-hidden="true" />
              <span className="tree-name">Environment &amp; Sky</span>
            </div>
          </li>
          {rows.length === 0 && (
            <li role="none">
              <EmptyState icon={EnvironmentIcon} title={query ? 'No matches' : 'Empty scene'}>
                {query ? `Nothing is called “${query}”.` : 'Use the Add button to put something in your world.'}
              </EmptyState>
            </li>
          )}
          {rows.map(({ object: o, depth, children }) => {
            const selected = selection.includes(o.id);
            const isCollapsed = collapsed.has(o.id);
            const dropHere = drag?.target?.id === o.id ? drag.target.position : undefined;
            return (
              <li role="none" key={o.id}>
                <div
                  className="tree-row"
                  role="treeitem"
                  aria-selected={selected}
                  aria-expanded={children > 0 ? !isCollapsed : undefined}
                  aria-level={depth + 1}
                  data-row-id={o.id}
                  data-hidden={!o.visible}
                  data-drop={dropHere}
                  data-testid={`tree-row-${o.name}`}
                  tabIndex={selected ? 0 : -1}
                  style={{ paddingLeft: 4 + depth * 18 }}
                  onClick={(e) => session.select([o.id], multi || e.shiftKey || e.metaKey || e.ctrlKey)}
                  onDoubleClick={() => !playing && setRenaming(o.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ anchor: e.currentTarget, obj: o });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      session.select([o.id]);
                    }
                    if (e.key === 'F2' && !playing) setRenaming(o.id);
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const rowsEls = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [])];
                      const i = rowsEls.indexOf(e.currentTarget);
                      const next = rowsEls[e.key === 'ArrowDown' ? i + 1 : i - 1];
                      if (next) {
                        next.focus();
                        session.select([next.dataset.rowId as string]);
                      }
                    }
                    if (e.key === 'ArrowLeft' && children && !isCollapsed) toggleCollapse(o.id);
                    if (e.key === 'ArrowRight' && children && isCollapsed) toggleCollapse(o.id);
                  }}
                >
                  {!query && (
                    <span
                      className="tree-toggle"
                      aria-hidden="true"
                      style={{ cursor: playing ? 'default' : 'grab', touchAction: 'none' }}
                      title="Drag to reorder or put inside another object"
                      onPointerDown={(e) => {
                        if (playing) return;
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDrag({ id: o.id, pointerId: e.pointerId, target: null });
                      }}
                      onPointerMove={(e) => drag?.pointerId === e.pointerId && updateDropTarget(e.clientX, e.clientY)}
                      onPointerUp={(e) => {
                        if (drag?.pointerId !== e.pointerId) return;
                        if (drag.target) session.moveInHierarchy(drag.id, drag.target.id, drag.target.position);
                        setDrag(null);
                      }}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  {children > 0 && !query ? (
                    <button
                      type="button"
                      className="tree-toggle"
                      aria-label={isCollapsed ? `Expand ${o.name}` : `Collapse ${o.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(o.id);
                      }}
                    >
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>
                  ) : (
                    <span style={{ width: 24, flexShrink: 0 }} />
                  )}
                  <span className="tree-icon">
                    <ObjectIcon type={o.type} />
                  </span>
                  {renaming === o.id ? (
                    <input
                      className="tree-name-input"
                      defaultValue={o.name}
                      aria-label={`Rename ${o.name}`}
                      autoFocus
                      maxLength={64}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== o.name) session.rename(o.id, v);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="tree-name">{o.name}</span>
                  )}
                  <span className="tree-actions">
                    {advanced && o.locked && <Lock size={14} aria-label="Locked" style={{ margin: '0 4px', color: 'var(--text-faint)' }} />}
                    <IconButton
                      icon={o.visible ? Eye : EyeOff}
                      label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
                      size="sm"
                      disabled={playing}
                      onClick={(e) => {
                        e.stopPropagation();
                        session.setVisible(o.id, !o.visible);
                      }}
                    />
                    <IconButton
                      icon={Ellipsis}
                      label={`Actions for ${o.name}`}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ anchor: e.currentTarget, obj: o });
                      }}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label={`Actions for ${menu.obj.name}`} align="end" onClose={() => setMenu(null)}>
          <MenuItem icon={Pencil} label="Rename" hint="F2" disabled={playing} onSelect={() => setRenaming(menu.obj.id)} />
          <MenuItem icon={Focus} label="Focus" hint="F" onSelect={() => onFocus(menu.obj.id)} />
          <MenuItem icon={CopyPlus} label="Duplicate" hint="⌘D" disabled={playing} onSelect={() => session.duplicateObjects([menu.obj.id])} />
          <MenuItem
            icon={Group}
            label="Group"
            hint="⌘G"
            disabled={playing}
            onSelect={() => {
              if (!selection.includes(menu.obj.id)) session.select([menu.obj.id]);
              session.groupSelection();
            }}
          />
          {menu.obj.parentId && (
            <MenuItem icon={Ungroup} label="Move out of group" disabled={playing} onSelect={() => session.moveInHierarchy(menu.obj.id, null, 'after')} />
          )}
          {advanced && (
            <MenuItem
              icon={menu.obj.locked ? LockOpen : Lock}
              label={menu.obj.locked ? 'Unlock' : 'Lock (stop selecting in 3D view)'}
              disabled={playing}
              onSelect={() => session.setLocked(menu.obj.id, !menu.obj.locked)}
            />
          )}
          <div className="menu-sep" />
          <MenuItem
            icon={Trash}
            label="Delete"
            hint="⌫"
            danger
            disabled={playing}
            onSelect={() => void deleteSelection(deps, selection.includes(menu.obj.id) ? selection : [menu.obj.id])}
          />
        </Menu>
      )}
    </>
  );
}
