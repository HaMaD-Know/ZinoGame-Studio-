import { useEffect, useRef, useState } from 'react';
import { resolvedTheme, usePreferences } from '../../app/preferences';
import { Button, Spinner } from '../../components/ui';
import type { Diagnostic } from '../../engine/scripting/ast';
import { buildToolbox, loadBlockly, zinoTheme } from './blocklySetup';

type BlocklyModule = typeof import('blockly/core');
type Workspace = import('blockly/core').WorkspaceSvg;

export interface BlockEditorHandle {
  selectBlock: (id: string) => void;
}

/**
 * Blockly workspace for one script. Emits the serialised workspace state
 * (debounced) whenever blocks change, and reports the selected block id so
 * the code preview can highlight the matching lines.
 */
export function BlockEditor({
  scriptId,
  initialState,
  diagnostics,
  onChange,
  onSelectBlock,
  handleRef,
}: {
  scriptId: string;
  initialState: unknown;
  diagnostics: Diagnostic[];
  onChange: (state: unknown) => void;
  onSelectBlock: (id: string | null) => void;
  handleRef?: React.MutableRefObject<BlockEditorHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Workspace | null>(null);
  const blocklyRef = useRef<BlocklyModule | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const prefs = usePreferences();
  const dark = resolvedTheme(prefs.theme) === 'dark';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelectBlock);
  onSelectRef.current = onSelectBlock;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    setStatus('loading');
    loadBlockly()
      .then((Blockly) => {
        if (disposed || !host.current) return;
        blocklyRef.current = Blockly;
        const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const ws = Blockly.inject(host.current, {
          toolbox: buildToolbox() as never,
          renderer: 'zelos',
          // Bundled locally so the editor works offline inside the iOS app.
          media: './blockly-media/',
          theme: zinoTheme(Blockly, dark),
          trashcan: true,
          sounds: false,
          zoom: { controls: true, wheel: true, startScale: coarse ? 0.85 : 0.75, maxScale: 2, minScale: 0.35, scaleSpeed: 1.15, pinch: true },
          move: { scrollbars: true, drag: true, wheel: false },
          grid: { spacing: 24, length: 2, colour: dark ? '#2a3555' : '#d6deee', snap: true },
        });
        wsRef.current = ws;
        // Load without firing change events: loading must never trigger a save,
        // so blocks that fail to load can never overwrite the stored script.
        Blockly.Events.disable();
        try {
          if (initialState && typeof initialState === 'object') {
            Blockly.serialization.workspaces.load(initialState as never, ws, { recordUndo: false });
          }
        } catch (err) {
          setError(`Some blocks could not be loaded: ${(err as Error).message}. Your saved script was not changed.`);
        } finally {
          Blockly.Events.enable();
        }
        ws.addChangeListener((event: import('blockly/core').Events.Abstract) => {
          if (event.type === Blockly.Events.SELECTED) {
            onSelectRef.current((event as import('blockly/core').Events.Selected).newElementId ?? null);
            return;
          }
          if (event.isUiEvent || ws.isDragging()) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (disposed) return;
            onChangeRef.current(Blockly.serialization.workspaces.save(ws));
          }, 250);
        });
        resizeObserver = new ResizeObserver(() => Blockly.svgResize(ws));
        resizeObserver.observe(host.current);
        if (handleRef) {
          handleRef.current = {
            selectBlock: (id: string) => {
              const block = ws.getBlockById(id);
              if (!block) return;
              block.select();
              ws.centerOnBlock(id);
            },
          };
        }
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setStatus('error');
        setError((err as Error).message);
      });
    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        // Flush pending edits so nothing typed in the last moment is lost.
        const ws = wsRef.current;
        const Blockly = blocklyRef.current;
        if (ws && Blockly) onChangeRef.current(Blockly.serialization.workspaces.save(ws));
      }
      resizeObserver?.disconnect();
      wsRef.current?.dispose();
      wsRef.current = null;
      if (handleRef) handleRef.current = null;
    };
    // Recreate the workspace when switching scripts, theme or after a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId, dark, retry]);

  // Show diagnostics directly on the blocks they belong to.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || status !== 'ready') return;
    const byBlock = new Map<string, string[]>();
    for (const d of diagnostics) {
      if (!d.nodeId) continue;
      const id = d.nodeId.replace(/_note$/, '');
      byBlock.set(id, [...(byBlock.get(id) ?? []), d.message]);
    }
    for (const block of ws.getAllBlocks(false)) {
      const messages = byBlock.get(block.id);
      block.setWarningText(messages ? messages.join('\n') : null);
    }
  }, [diagnostics, status]);

  return (
    <div className="blockly-host" data-testid="block-editor">
      <div ref={host} className="blockly-div" />
      {status === 'loading' && (
        <div className="viewport-message">
          <Spinner label="Loading blocks" />
        </div>
      )}
      {status === 'error' && (
        <div className="viewport-message">
          <div className="card stack" role="alert">
            <strong>The block editor could not start</strong>
            <p className="small muted">{error}</p>
            <Button onClick={() => setRetry((r) => r + 1)}>Try again</Button>
          </div>
        </div>
      )}
      {status === 'ready' && error && (
        <div className="viewport-hud">
          <div className="banner banner-warning small">{error}</div>
        </div>
      )}
    </div>
  );
}
