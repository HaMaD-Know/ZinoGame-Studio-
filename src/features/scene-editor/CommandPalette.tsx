import { useMemo, useState } from 'react';
import { Dialog } from '../../components/feedback';
import { ObjectIcon } from '../../components/icons';
import type { EditorSession } from '../../editor/EditorSession';
import type { EditorAction } from './editorActions';

/** Searchable list of every editor action and every object in the scene. */
export function CommandPalette({ actions, session, onClose }: { actions: EditorAction[]; session: EditorSession; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();

  const items = useMemo(() => {
    const matches = (text: string) => !q || q.split(/\s+/).every((w) => text.toLowerCase().includes(w));
    const actionItems = actions
      .filter((a) => a.enabled() && matches(`${a.label} ${a.group} ${a.keywords ?? ''}`))
      .map((a) => ({ key: a.id, label: a.label, hint: a.shortcut, group: a.group, icon: <a.icon size={18} aria-hidden="true" />, run: a.run }));
    const objectItems = q
      ? session.scene.objects
          .filter((o) => matches(`${o.name} ${o.type}`))
          .slice(0, 12)
          .map((o) => ({
            key: o.id,
            label: `Select “${o.name}”`,
            hint: undefined,
            group: 'Objects',
            icon: <ObjectIcon type={o.type} />,
            run: () => session.select([o.id]),
          }))
      : [];
    return [...actionItems, ...objectItems].slice(0, 40);
  }, [actions, session, q]);

  const runItem = (i: number) => {
    const item = items[i];
    if (!item) return;
    onClose();
    void item.run();
  };

  return (
    <Dialog title="What do you want to do?" onClose={onClose} className="command-palette">
      <input
        className="input"
        placeholder="Search actions and objects…"
        aria-label="Search actions and objects"
        value={query}
        data-autofocus
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            runItem(active);
          }
        }}
      />
      <div className="command-list" role="listbox" aria-label="Results">
        {items.length === 0 && <p className="muted small" style={{ padding: 12 }}>Nothing matches “{query}”.</p>}
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={i === active}
            data-active={i === active}
            className="menu-item"
            onMouseEnter={() => setActive(i)}
            onClick={() => runItem(i)}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className="menu-hint">{item.hint ?? item.group}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
