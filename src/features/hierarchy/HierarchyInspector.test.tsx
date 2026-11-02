// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../../editor/EditorSession';
import { createProjectFromTemplate } from '../../engine/project/templates';
import { MemoryProjectStorage } from '../../engine/storage/MemoryProjectStorage';
import { InspectorPanel } from '../inspector/InspectorPanel';
import type { ActionDeps } from '../scene-editor/editorActions';
import { HierarchyPanel } from './HierarchyPanel';

vi.mock('../../app/AppController', () => ({
  useApp: () => ({ navigate: vi.fn(), openScript: vi.fn() }),
}));

function setup() {
  const project = createProjectFromTemplate({ name: 'RTL', template: 'empty-baseplate' });
  const session = new EditorSession(project, { storage: new MemoryProjectStorage(), autosave: { enabled: false, delayMs: 1000 } });
  const deps: ActionDeps = {
    session,
    viewport: null,
    confirm: vi.fn(async () => true),
    toast: vi.fn(),
    play: { playing: false, start: vi.fn(async () => {}), stop: vi.fn() },
  };
  render(
    <div>
      <HierarchyPanel session={session} deps={deps} onFocus={vi.fn()} />
      <InspectorPanel session={session} deps={deps} />
    </div>,
  );
  return { session, deps };
}

describe('Hierarchy and Inspector', () => {
  it('lists the default baseplate scene and shows an empty inspector', () => {
    setup();
    for (const name of ['Baseplate', 'Camera', 'Sun', 'Player Spawn']) expect(screen.getByTestId(`tree-row-${name}`)).toBeInTheDocument();
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });

  it('selecting a row updates the inspector, and renaming updates the row', () => {
    const { session } = setup();
    fireEvent.click(screen.getByTestId('tree-row-Baseplate'));
    expect(screen.getByTestId('tree-row-Baseplate')).toHaveAttribute('aria-selected', 'true');
    const inspector = screen.getByTestId('object-inspector');
    expect(within(inspector).getByRole('group', { name: 'Baseplate size presets' })).toBeInTheDocument();

    const name = within(inspector).getByLabelText('Object name');
    fireEvent.change(name, { target: { value: 'Ground' } });
    fireEvent.blur(name);
    expect(screen.getByTestId('tree-row-Ground')).toBeInTheDocument();
    expect(session.getState().undoLabel).toBe('Rename');

    act(() => session.undo());
    expect(screen.getByTestId('tree-row-Baseplate')).toBeInTheDocument();
  });

  it('resizes the baseplate from a preset and toggles visibility from the hierarchy', () => {
    const { session } = setup();
    fireEvent.click(screen.getByTestId('tree-row-Baseplate'));
    fireEvent.click(screen.getByRole('button', { name: '256' }));
    const bp = session.scene.objects.find((o) => o.type === 'baseplate')!;
    expect(bp.components.baseplate).toMatchObject({ width: 256, depth: 256 });
    fireEvent.click(screen.getByRole('button', { name: 'Hide Baseplate' }));
    expect(session.scene.objects.find((o) => o.type === 'baseplate')!.visible).toBe(false);
    expect(screen.getByTestId('tree-row-Baseplate')).toHaveAttribute('data-hidden', 'true');
  });

  it('filters objects with search', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search objects'), { target: { value: 'spawn' } });
    expect(screen.getByTestId('tree-row-Player Spawn')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-row-Camera')).not.toBeInTheDocument();
  });

  it('shows environment settings when Environment & Sky is selected', () => {
    setup();
    fireEvent.click(screen.getByText('Environment & Sky'));
    expect(screen.getByTestId('environment-inspector')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Spawn a player at the spawn point' })).toBeChecked();
  });
});

describe('Touch multi-select', () => {
  it('selects several objects with the Select several toggle', () => {
    const { session } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select several' }));
    fireEvent.click(screen.getByTestId('tree-row-Camera'));
    fireEvent.click(screen.getByTestId('tree-row-Sun'));
    expect(session.getState().selection).toHaveLength(2);
    expect(screen.getByText('2 objects selected')).toBeInTheDocument();
  });
});
