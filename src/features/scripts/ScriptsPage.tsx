import {
  BookOpen,
  Blocks,
  CircleAlert,
  CodeXml,
  FileCode,
  Info,
  Pencil,
  Plus,
  Trash,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppController';
import { usePreferences } from '../../app/preferences';
import { useEditor, useSession } from '../../app/services';
import { Dialog, useConfirm, useToast } from '../../components/feedback';
import { Button, EmptyState, IconButton, Segmented } from '../../components/ui';
import { BUILTINS, EVENT_DOCS, IMPLICIT_VARIABLES, NAMED_BUTTONS, type ApiCategory } from '../../engine/scripting/api';
import type { Diagnostic } from '../../engine/scripting/ast';
import { formatSource } from '../../engine/scripting/compile';
import { linesForNode, nodeAtLine } from '../../engine/scripting/printer';
import { blocksToText, compileScriptDoc, textToBlocks } from '../../engine/scripting/scriptDoc';
import type { ScriptDoc } from '../../engine/project/types';
import { BlockEditor, type BlockEditorHandle } from './BlockEditor';
import { CodeView } from './CodeView';
import type { CodeEditorHandle } from './SimpleCodeEditor';
import { TextEditor } from './TextEditor';

export default function ScriptsPage() {
  const session = useSession();
  const app = useApp();
  const scripts = useEditor(session, (s) => s.project.scripts);
  const list = useMemo(() => Object.values(scripts).sort((a, b) => a.name.localeCompare(b.name)), [scripts]);
  const [selectedId, setSelectedId] = useState<string | null>(app.scriptToOpen ?? list[0]?.id ?? null);
  const [showApi, setShowApi] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const prefs = usePreferences();

  useEffect(() => {
    if (app.scriptToOpen && scripts[app.scriptToOpen]) setSelectedId(app.scriptToOpen);
  }, [app.scriptToOpen, scripts]);

  useEffect(() => {
    if (selectedId && !scripts[selectedId]) setSelectedId(list[0]?.id ?? null);
  }, [scripts, selectedId, list]);

  const create = (mode: 'blocks' | 'text') => {
    const doc = session.createScript(mode === 'blocks' ? 'Block Script' : 'Code Script', mode);
    setSelectedId(doc.id);
  };

  const remove = async (doc: ScriptDoc) => {
    const users = session.objectsUsingScript(doc.id);
    const ok = await confirm({
      title: `Delete “${doc.name}”?`,
      message: users.length
        ? `It is attached to ${users.map((u) => `“${u.name}”`).join(', ')}. It will be removed from those objects.`
        : 'This script is not attached to any object.',
      confirmLabel: 'Delete script',
      danger: true,
    });
    if (!ok) return;
    session.deleteScript(doc.id);
    toast({ tone: 'success', title: `Deleted ${doc.name}` });
  };

  const selected = selectedId ? scripts[selectedId] : undefined;

  return (
    <div className="scripts-layout">
      <aside className="scripts-sidebar" aria-label="Scripts">
        <div className="panel-header" style={{ paddingTop: 'calc(10px + var(--safe-top))' }}>
          <h2>Scripts</h2>
          <IconButton icon={BookOpen} label="Script API reference" size="sm" onClick={() => setShowApi(true)} />
        </div>
        <div className="row row-wrap" style={{ padding: 10 }}>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => create('blocks')}>
            New blocks
          </Button>
          {prefs.editorMode === 'advanced' && (
            <Button size="sm" icon={Plus} onClick={() => create('text')}>
              New code
            </Button>
          )}
        </div>
        <div className="panel-scroll" style={{ padding: '0 6px 10px' }}>
          {list.length === 0 && <p className="small muted" style={{ padding: 10 }}>No scripts yet.</p>}
          {list.map((doc) => {
            const users = session.objectsUsingScript(doc.id).length;
            return (
              <button key={doc.id} type="button" className="script-list-item" aria-current={doc.id === selectedId} onClick={() => setSelectedId(doc.id)}>
                {doc.mode === 'blocks' ? <Blocks size={18} aria-hidden="true" /> : <FileCode size={18} aria-hidden="true" />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
                  <span className="small faint">{users ? `Used by ${users} object${users === 1 ? '' : 's'}` : 'Not attached'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      {selected ? (
        <ScriptEditor key={selected.id} doc={selected} onDelete={() => void remove(selected)} onShowApi={() => setShowApi(true)} />
      ) : (
        <div className="page">
          <EmptyState
            icon={CodeXml}
            title="Make things happen with scripts"
            action={
              <Button variant="primary" icon={Plus} onClick={() => create('blocks')}>
                Create a block script
              </Button>
            }
          >
            Snap blocks together to make objects spin, jump, score points and react when touched. Then attach the script to an object in the Inspector.
          </EmptyState>
        </div>
      )}
      {showApi && <ApiReference onClose={() => setShowApi(false)} />}
    </div>
  );
}

function ScriptEditor({ doc, onDelete, onShowApi }: { doc: ScriptDoc; onDelete: () => void; onShowApi: () => void }) {
  const session = useSession();
  const prefs = usePreferences();
  const toast = useToast();
  const confirm = useConfirm();
  const advanced = prefs.editorMode === 'advanced';
  const [text, setText] = useState(doc.source);
  const [highlightNode, setHighlightNode] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [convertIssues, setConvertIssues] = useState<{ title: string; items: string[] } | null>(null);
  const blockHandle = useRef<BlockEditorHandle | null>(null);
  const textHandle = useRef<CodeEditorHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingText = useRef<string | null>(null);

  // Compile for diagnostics and the code preview (cheap: scripts are small).
  const compiled = useMemo(() => compileScriptDoc(doc.mode === 'text' ? { ...doc, source: text } : doc), [doc, text]);
  const users = session.objectsUsingScript(doc.id);

  const flushText = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pendingText.current !== null) {
      session.updateScript(doc.id, { source: pendingText.current });
      pendingText.current = null;
    }
  }, [session, doc.id]);
  useEffect(() => flushText, [flushText]);

  const onTextChange = (v: string) => {
    setText(v);
    pendingText.current = v;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushText, 500);
  };

  const onBlocksChange = useCallback(
    (state: unknown) => {
      const code = compileScriptDoc({ mode: 'blocks', source: '', blocks: state }).code;
      session.updateScript(doc.id, { blocks: state, source: code });
    },
    [session, doc.id],
  );

  const toText = async () => {
    const result = blocksToText(doc.blocks);
    if (result.looseBlockIds.length) {
      const ok = await confirm({
        title: 'Some blocks are not inside an event',
        message: `${result.looseBlockIds.length} group(s) of blocks are not inside an event, so they do not run and are not part of the code. They will be left out of the text version. Continue?`,
        confirmLabel: 'Switch to code',
      });
      if (!ok) return;
    }
    session.updateScript(doc.id, { mode: 'text', source: result.text });
    setText(result.text);
  };

  const toBlocks = () => {
    flushText();
    const result = textToBlocks(text);
    if (!result.ok) {
      setConvertIssues(
        result.reason === 'syntax'
          ? { title: 'Fix these errors first', items: result.diagnostics.map((d) => `Line ${d.loc?.line ?? '?'}: ${d.message}`) }
          : {
              title: 'This code uses things blocks can’t show yet',
              items: result.issues.map((i) => (i.line ? `Line ${i.line}: ${i.message}` : i.message)),
            },
      );
      return;
    }
    session.updateScript(doc.id, { mode: 'blocks', blocks: result.blocks, source: result.generatedText, textBackup: result.textBackup });
    toast({
      tone: 'success',
      title: 'Converted to blocks',
      description: result.generatedText.trim() === text.trim() ? undefined : 'The code was tidied up. Your original text is kept as a backup.',
    });
  };

  const format = () => {
    const formatted = formatSource(text);
    if (formatted === null) {
      toast({ tone: 'warning', title: 'Fix the errors first', description: 'Code with errors is never reformatted, so nothing can be lost.' });
      return;
    }
    textHandle.current?.setValue(formatted);
    onTextChange(formatted);
  };

  const highlight = highlightNode ? linesForNode(compiled.sourceMap, highlightNode) : null;
  const goToDiagnostic = (d: Diagnostic) => {
    if (doc.mode === 'blocks' && d.nodeId) blockHandle.current?.selectBlock(d.nodeId.replace(/_note$/, ''));
    else if (d.loc) textHandle.current?.revealLine(d.loc.line);
  };
  const errorCount = compiled.diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <section className="script-editor" aria-label={`Script ${doc.name}`}>
      <header className="script-editor-header">
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="row">
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>{doc.name}</h1>
            <IconButton icon={Pencil} label="Rename script" size="sm" onClick={() => setRenaming(true)} />
          </div>
          <span className="small muted">
            {users.length ? `Attached to ${users.map((u) => u.name).join(', ')}` : 'Not attached — select an object and use “Add script” in the Inspector.'}
          </span>
        </div>
        <span className={`chip ${errorCount ? 'chip-danger' : compiled.diagnostics.length ? 'chip-warning' : 'chip-success'}`} role="status">
          {errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : compiled.diagnostics.length ? `${compiled.diagnostics.length} warning(s)` : 'Ready to run'}
        </span>
        {(advanced || doc.mode === 'text') && (
          <Segmented
            label="Editing mode"
            value={doc.mode}
            onChange={(m) => (m === 'text' ? void toText() : toBlocks())}
            options={[
              { value: 'blocks', label: 'Blocks', icon: Blocks },
              { value: 'text', label: 'Code', icon: CodeXml },
            ]}
          />
        )}
        {doc.mode === 'text' && (
          <Button size="sm" icon={WandSparkles} onClick={format}>
            Tidy code
          </Button>
        )}
        <IconButton icon={BookOpen} label="Script API reference" onClick={onShowApi} />
        <IconButton icon={Trash} label="Delete script" onClick={onDelete} />
      </header>
      <div className="script-editor-body" style={{ minHeight: 0 }}>
        <div style={{ minHeight: 0, minWidth: 0, position: 'relative' }}>
          {doc.mode === 'blocks' ? (
            <BlockEditor
              scriptId={doc.id}
              initialState={doc.blocks}
              diagnostics={compiled.diagnostics}
              onChange={onBlocksChange}
              onSelectBlock={setHighlightNode}
              handleRef={blockHandle}
            />
          ) : (
            <TextEditor ref={textHandle} scriptId={doc.id} value={text} onChange={onTextChange} diagnostics={compiled.diagnostics} />
          )}
        </div>
        <aside className="code-preview" aria-label={doc.mode === 'blocks' ? 'Generated code' : 'Problems'}>
          {doc.mode === 'blocks' && (
            <>
              <div className="panel-header">
                <h2>Code</h2>
                <span className="small faint">Tap a block to see its code</span>
              </div>
              <CodeView
                label="Code generated from the blocks"
                code={compiled.code || '// Drag an event block (like “when the game starts”) to begin.\n'}
                highlight={highlight ? { start: highlight.startLine, end: highlight.endLine } : null}
                onLineClick={(line) => {
                  const id = nodeAtLine(compiled.sourceMap, line);
                  if (id) blockHandle.current?.selectBlock(id.replace(/_note$/, ''));
                }}
              />
              {!advanced && (
                <p className="small muted" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
                  This is the Zino Script your blocks make. Switch to Advanced mode in Settings to edit code as text.
                </p>
              )}
            </>
          )}
          <div className="panel-header">
            <h2>Problems</h2>
            <span className="chip">{compiled.diagnostics.length}</span>
          </div>
          <div style={{ overflow: 'auto', flex: doc.mode === 'blocks' ? '0 1 40%' : 1 }}>
            {compiled.diagnostics.length === 0 ? (
              <p className="small muted" style={{ padding: 14 }}>
                No problems found.
              </p>
            ) : (
              compiled.diagnostics.map((d, i) => {
                const Icon = d.severity === 'error' ? CircleAlert : d.severity === 'warning' ? TriangleAlert : Info;
                return (
                  <button key={i} type="button" className="diag-item" onClick={() => goToDiagnostic(d)}>
                    <Icon size={16} className={`diag-icon-${d.severity}`} aria-hidden="true" />
                    <span className="small">
                      {d.loc ? <strong>Line {d.loc.line}: </strong> : null}
                      {d.message}
                      {d.hint && <span className="muted"> — {d.hint}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {doc.textBackup && doc.mode === 'blocks' && advanced && (
            <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Restore your original code?',
                    message: 'This switches the script back to the text you wrote before converting it to blocks. Changes made in blocks since then will be replaced.',
                    confirmLabel: 'Restore text',
                  });
                  if (ok) {
                    session.updateScript(doc.id, { mode: 'text', source: doc.textBackup ?? '' });
                    setText(doc.textBackup ?? '');
                  }
                }}
              >
                Restore original code
              </Button>
            </div>
          )}
        </aside>
      </div>
      {renaming && (
        <RenameScriptDialog
          name={doc.name}
          onClose={() => setRenaming(false)}
          onRename={(name) => {
            session.updateScript(doc.id, { name: name.trim().slice(0, 64) });
            setRenaming(false);
          }}
        />
      )}
      {convertIssues && (
        <Dialog title={convertIssues.title} icon={TriangleAlert} onClose={() => setConvertIssues(null)} actions={<Button variant="primary" onClick={() => setConvertIssues(null)}>Keep editing as code</Button>}>
          <p className="muted">Your code is safe and stays as text. You can keep using it exactly as it is.</p>
          <ul className="small">
            {convertIssues.items.slice(0, 12).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Dialog>
      )}
    </section>
  );
}

function RenameScriptDialog({ name, onClose, onRename }: { name: string; onClose: () => void; onRename: (n: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <Dialog
      title="Rename script"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={() => onRename(value)}>
            Rename
          </Button>
        </>
      }
    >
      <input className="input" aria-label="Script name" value={value} maxLength={64} onChange={(e) => setValue(e.target.value)} data-autofocus
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && onRename(value)} />
    </Dialog>
  );
}

const CATEGORY_LABELS: Record<ApiCategory, string> = {
  motion: 'Motion',
  physics: 'Physics',
  objects: 'Objects',
  game: 'Game',
  sound: 'Sound',
  input: 'Input',
  math: 'Math',
  debug: 'Debugging',
};

function ApiReference({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Zino Script reference" icon={BookOpen} wide onClose={onClose}>
      <p className="muted small">
        Every script is made of events. Code inside an event runs when that event happens. Scripts can only use the actions below, so they can never
        harm your device or project.
      </p>
      <h3>Events</h3>
      <ul className="small">
        {(Object.keys(EVENT_DOCS) as (keyof typeof EVENT_DOCS)[]).map((e) => (
          <li key={e}>
            <code>{e === 'button' ? 'on button("jump") { … }' : `on ${e} { … }`}</code> — {EVENT_DOCS[e]}
          </li>
        ))}
      </ul>
      <h3>Special names</h3>
      <ul className="small">
        {IMPLICIT_VARIABLES.map((v) => (
          <li key={v.name}>
            <code>{v.name}</code> — {v.doc}
          </li>
        ))}
        <li>
          Buttons: {NAMED_BUTTONS.map((b) => `${b.name} (${b.keys})`).join(', ')}, and single letters/digits.
        </li>
      </ul>
      {(Object.keys(CATEGORY_LABELS) as ApiCategory[]).map((cat) => (
        <div key={cat}>
          <h3>{CATEGORY_LABELS[cat]}</h3>
          <ul className="small">
            {BUILTINS.filter((b) => b.category === cat).map((b) => (
              <li key={b.name}>
                <code>
                  {b.name}({b.params.map((p) => p.name).join(', ')})
                </code>{' '}
                — {b.doc} <span className="faint">e.g. <code>{b.example}</code></span>
                {!b.block && <span className="chip" style={{ marginLeft: 6 }}>code only</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="small muted">Safety limits: a single event may run at most 100,000 steps, a loop at most 10,000 times, and functions may nest 64 deep.</p>
    </Dialog>
  );
}
