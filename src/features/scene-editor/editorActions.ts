import {
  Box,
  Camera,
  Circle,
  ClipboardPaste,
  Cone,
  Copy,
  CopyPlus,
  Cylinder,
  Eye,
  Flashlight,
  Focus,
  Grid3x3,
  Group,
  Lightbulb,
  MapPin,
  Mountain,
  MousePointer2,
  Move3d,
  Play,
  Redo2,
  Rotate3d,
  RotateCcw,
  Save,
  Scale3d,
  Scissors,
  Square,
  SquareDashed,
  Sun,
  Trash,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { preferences } from '../../app/preferences';
import type { ConfirmOptions, ToastOptions } from '../../components/feedback';
import type { EditorSession } from '../../editor/EditorSession';
import type { EditorViewport } from '../../engine/editor-viewport/EditorViewport';
import { deletionRemovesSpawnSupport, descendantIds, getObject } from '../../engine/scene/sceneOps';
import type { ObjectType } from '../../engine/scene/types';

export interface EditorAction {
  id: string;
  label: string;
  group: 'Add' | 'Edit' | 'Tools' | 'View' | 'Game' | 'Project';
  icon: LucideIcon;
  shortcut?: string;
  keywords?: string;
  enabled: () => boolean;
  run: () => void | Promise<void>;
}

export interface ActionDeps {
  session: EditorSession;
  viewport: EditorViewport | null;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (t: ToastOptions) => void;
  play: { playing: boolean; start: () => Promise<void>; stop: () => void };
}

export const ADD_OBJECT_ITEMS: { type: ObjectType; label: string; icon: LucideIcon; group: string; description: string }[] = [
  { type: 'cube', label: 'Cube', icon: Box, group: 'Shapes', description: 'A block' },
  { type: 'sphere', label: 'Sphere', icon: Circle, group: 'Shapes', description: 'A ball' },
  { type: 'cylinder', label: 'Cylinder', icon: Cylinder, group: 'Shapes', description: 'A tube or pillar' },
  { type: 'cone', label: 'Cone', icon: Cone, group: 'Shapes', description: 'A pointy shape' },
  { type: 'plane', label: 'Plane', icon: Square, group: 'Shapes', description: 'A flat square' },
  { type: 'directionalLight', label: 'Sun Light', icon: Sun, group: 'Lights', description: 'Lights everything from one direction' },
  { type: 'pointLight', label: 'Point Light', icon: Lightbulb, group: 'Lights', description: 'A glowing bulb' },
  { type: 'spotLight', label: 'Spot Light', icon: Flashlight, group: 'Lights', description: 'A cone of light' },
  { type: 'empty', label: 'Empty', icon: SquareDashed, group: 'Other', description: 'An invisible folder for grouping' },
  { type: 'camera', label: 'Camera', icon: Camera, group: 'Other', description: 'A view used in play mode' },
  { type: 'spawnPoint', label: 'Player Spawn', icon: MapPin, group: 'Other', description: 'Where the player starts' },
  { type: 'baseplate', label: 'Baseplate', icon: Mountain, group: 'Other', description: 'A big flat ground' },
];

export function addObject(deps: ActionDeps, type: ObjectType): void {
  const at = type === 'baseplate' || type === 'directionalLight' ? undefined : deps.viewport?.getSpawnPoint();
  const obj = deps.session.createObject(type, { at });
  if (obj && preferences.get().editorMode === 'beginner' && deps.session.getState().tool === 'select') {
    deps.session.setTool('translate');
  }
}

/** Deletes with confirmation when the deletion is surprising (baseplate under spawn, children). */
export async function deleteSelection(deps: ActionDeps, ids = deps.session.getState().selection): Promise<void> {
  const { session, confirm, toast } = deps;
  if (ids.length === 0) return;
  const scene = session.scene;
  const childCount = ids.reduce((n, id) => n + descendantIds(scene, id).length, 0);
  if (deletionRemovesSpawnSupport(scene, ids)) {
    const ok = await confirm({
      title: 'Delete the baseplate?',
      message:
        'The player spawn is standing on this baseplate. Without it, the player will fall when you press Play. You can undo this later.',
      confirmLabel: 'Delete anyway',
      danger: true,
    });
    if (!ok) return;
  } else if (childCount > 0) {
    const ok = await confirm({
      title: 'Delete with everything inside?',
      message: `This also deletes ${childCount} object${childCount === 1 ? '' : 's'} inside it. You can undo this.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
  }
  const name = ids.length === 1 ? (getObject(scene, ids[0] as string)?.name ?? 'object') : `${ids.length} objects`;
  if (session.deleteObjects(ids)) toast({ tone: 'info', title: `Deleted ${name}`, description: 'Use Undo to bring it back.' });
}

export function buildEditorActions(deps: ActionDeps): EditorAction[] {
  const { session, viewport, play } = deps;
  const hasSelection = () => session.getState().selection.length > 0;
  const editing = () => !session.isPlaying;
  const actions: EditorAction[] = [
    ...ADD_OBJECT_ITEMS.map(
      (item): EditorAction => ({
        id: `add.${item.type}`,
        label: `Add ${item.label}`,
        group: 'Add',
        icon: item.icon,
        keywords: `${item.group} ${item.description} create new`,
        enabled: editing,
        run: () => addObject(deps, item.type),
      }),
    ),
    { id: 'edit.undo', label: 'Undo', group: 'Edit', icon: Undo2, shortcut: '⌘Z', enabled: () => editing() && session.getState().canUndo, run: () => session.undo() },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', icon: Redo2, shortcut: '⇧⌘Z', enabled: () => editing() && session.getState().canRedo, run: () => session.redo() },
    { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', icon: CopyPlus, shortcut: '⌘D', enabled: () => editing() && hasSelection(), run: () => void session.duplicateObjects() },
    { id: 'edit.copy', label: 'Copy', group: 'Edit', icon: Copy, shortcut: '⌘C', enabled: hasSelection, run: () => void session.copy() },
    { id: 'edit.cut', label: 'Cut', group: 'Edit', icon: Scissors, shortcut: '⌘X', enabled: () => editing() && hasSelection(), run: () => void session.cut() },
    { id: 'edit.paste', label: 'Paste', group: 'Edit', icon: ClipboardPaste, shortcut: '⌘V', enabled: () => editing() && session.hasClipboard, run: () => void session.paste() },
    { id: 'edit.group', label: 'Group selection', group: 'Edit', icon: Group, shortcut: '⌘G', enabled: () => editing() && hasSelection(), run: () => void session.groupSelection() },
    { id: 'edit.delete', label: 'Delete', group: 'Edit', icon: Trash, shortcut: '⌫', enabled: () => editing() && hasSelection(), run: () => deleteSelection(deps) },
    { id: 'tool.select', label: 'Select tool', group: 'Tools', icon: MousePointer2, shortcut: 'Q', enabled: editing, run: () => session.setTool('select') },
    { id: 'tool.move', label: 'Move tool', group: 'Tools', icon: Move3d, shortcut: 'W', enabled: editing, run: () => session.setTool('translate') },
    { id: 'tool.rotate', label: 'Rotate tool', group: 'Tools', icon: Rotate3d, shortcut: 'E', enabled: editing, run: () => session.setTool('rotate') },
    { id: 'tool.scale', label: 'Scale tool', group: 'Tools', icon: Scale3d, shortcut: 'R', enabled: editing, run: () => session.setTool('scale') },
    { id: 'view.frame', label: 'Focus on selection', group: 'View', icon: Focus, shortcut: 'F', keywords: 'frame zoom', enabled: () => !!viewport && editing(), run: () => viewport?.frameSelection() },
    { id: 'view.reset', label: 'Reset camera', group: 'View', icon: RotateCcw, keywords: 'home view', enabled: () => !!viewport && editing(), run: () => viewport?.resetView() },
    {
      id: 'view.grid',
      label: 'Show / hide grid',
      group: 'View',
      icon: Grid3x3,
      keywords: 'toggle',
      enabled: () => true,
      run: () => preferences.update((p) => ({ showGrid: !p.showGrid })),
    },
    {
      id: 'view.colliders',
      label: 'Show / hide colliders',
      group: 'View',
      icon: Eye,
      keywords: 'physics collision debug',
      enabled: () => preferences.get().editorMode === 'advanced',
      run: () => preferences.update((p) => ({ showColliders: !p.showColliders })),
    },
    {
      id: 'game.play',
      label: play.playing ? 'Stop game' : 'Play game',
      group: 'Game',
      icon: Play,
      shortcut: '⌘↵',
      keywords: 'run test start stop',
      enabled: () => !!viewport,
      run: () => (play.playing ? play.stop() : play.start()),
    },
    { id: 'project.save', label: 'Save now', group: 'Project', icon: Save, shortcut: '⌘S', enabled: () => true, run: () => void session.save() },
  ];
  return actions;
}
