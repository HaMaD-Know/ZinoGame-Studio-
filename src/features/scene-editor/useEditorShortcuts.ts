import { useEffect, useRef } from 'react';
import type { EditorSession } from '../../editor/EditorSession';
import { deleteSelection, type ActionDeps } from './editorActions';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.monaco-editor, .blocklyWidgetDiv, .blocklyDropDownDiv');
}

/** Keyboard shortcuts for iPad keyboards and desktops. Disabled while typing or when hidden. */
export function useEditorShortcuts(
  session: EditorSession,
  deps: ActionDeps,
  enabled: boolean,
  extra: { openPalette: () => void },
): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const extraRef = useRef(extra);
  extraRef.current = extra;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.dialog-backdrop')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const d = depsRef.current;
      const playing = session.isPlaying;

      if (mod && key === 'k') {
        e.preventDefault();
        extraRef.current.openPalette();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void session.save();
        return;
      }
      if (mod && key === 'enter') {
        e.preventDefault();
        if (d.play.playing) d.play.stop();
        else void d.play.start();
        return;
      }
      if (playing) {
        if (key === 'escape') d.play.stop();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) session.redo();
        else session.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        session.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        session.duplicateObjects();
        return;
      }
      if (mod && key === 'c') {
        if (session.copy()) e.preventDefault();
        return;
      }
      if (mod && key === 'x') {
        if (session.cut()) e.preventDefault();
        return;
      }
      if (mod && key === 'v') {
        if (session.hasClipboard) {
          e.preventDefault();
          session.paste();
        }
        return;
      }
      if (mod && key === 'g') {
        e.preventDefault();
        session.groupSelection();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        session.select(session.scene.objects.map((o) => o.id));
        return;
      }
      if (mod || e.altKey) return;
      switch (key) {
        case 'delete':
        case 'backspace':
          e.preventDefault();
          void deleteSelection(d);
          break;
        case 'escape':
          session.clearSelection();
          break;
        case 'q':
          session.setTool('select');
          break;
        case 'w':
          session.setTool('translate');
          break;
        case 'e':
          session.setTool('rotate');
          break;
        case 'r':
          session.setTool('scale');
          break;
        case 'f':
          d.viewport?.frameSelection();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, enabled]);
}
