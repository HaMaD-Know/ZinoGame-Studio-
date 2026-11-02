import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { resolvedTheme, usePreferences } from '../../app/preferences';
import { Spinner } from '../../components/ui';
import type { Diagnostic } from '../../engine/scripting/ast';
import { hasFinePointer } from '../../platform/platform';
import { loadMonaco, ZINO_LANGUAGE_ID } from './monacoSetup';
import { SimpleCodeEditor, type CodeEditorHandle } from './SimpleCodeEditor';

type MonacoEditor = import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneCodeEditor;

/**
 * Text code editor: Monaco when available (and preferred), otherwise the
 * simple editor. Monaco failures fall back automatically, keeping the text.
 */
export const TextEditor = forwardRef<
  CodeEditorHandle,
  { scriptId: string; value: string; onChange: (v: string) => void; diagnostics: Diagnostic[]; onFormat?: () => void }
>(function TextEditor({ scriptId, value, onChange, diagnostics }, ref) {
  const prefs = usePreferences();
  const wantMonaco = prefs.textEditor === 'monaco' || (prefs.textEditor === 'auto' && hasFinePointer());
  const [mode, setMode] = useState<'loading' | 'monaco' | 'simple'>(wantMonaco ? 'loading' : 'simple');
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor/esm/vs/editor/editor.api.js') | null>(null);
  const simpleRef = useRef<CodeEditorHandle>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dark = resolvedTheme(prefs.theme) === 'dark';

  useEffect(() => {
    setMode(wantMonaco ? 'loading' : 'simple');
  }, [wantMonaco]);

  useEffect(() => {
    if (mode !== 'loading' || !host.current) return;
    let disposed = false;
    loadMonaco()
      .then((monaco) => {
        if (disposed || !host.current) return;
        monacoRef.current = monaco;
        const editor = monaco.editor.create(host.current, {
          value: valueRef.current,
          language: ZINO_LANGUAGE_ID,
          theme: dark ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          tabSize: 2,
          insertSpaces: true,
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          fixedOverflowWidgets: true,
          ariaLabel: 'Script code',
        });
        editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
        editorRef.current = editor;
        setMode('monaco');
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setFallbackReason(`The full code editor could not start (${(err as Error).message}). Using the simple editor instead.`);
        setMode('simple');
      });
    return () => {
      disposed = true;
    };
  }, [mode, dark]);

  // Dispose Monaco when unmounting or switching scripts.
  useEffect(
    () => () => {
      editorRef.current?.getModel()?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    },
    [scriptId],
  );

  // External value changes (e.g. formatting) update the editor without losing the cursor.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      const model = editor.getModel();
      if (model) editor.executeEdits('zino', [{ range: model.getFullModelRange(), text: value }]);
    }
  }, [value]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'zino',
      diagnostics
        .filter((d) => d.loc)
        .map((d) => ({
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
          message: d.hint ? `${d.message}\n${d.hint}` : d.message,
          startLineNumber: d.loc!.line,
          startColumn: d.loc!.column,
          endLineNumber: d.loc!.endLine,
          endColumn: Math.max(d.loc!.endColumn, d.loc!.column + 1),
        })),
    );
  }, [diagnostics, mode]);

  useImperativeHandle(ref, () => ({
    revealLine: (line) => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(line);
        editorRef.current.setPosition({ lineNumber: line, column: 1 });
        editorRef.current.focus();
      } else simpleRef.current?.revealLine(line);
    },
    getValue: () => editorRef.current?.getValue() ?? simpleRef.current?.getValue() ?? valueRef.current,
    setValue: (v) => {
      editorRef.current?.setValue(v);
      simpleRef.current?.setValue(v);
    },
  }));

  if (mode === 'simple') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {fallbackReason && <div className="banner banner-warning small" style={{ borderRadius: 0 }}>{fallbackReason}</div>}
        <div style={{ flex: 1, minHeight: 0 }}>
          <SimpleCodeEditor key={scriptId} ref={simpleRef} value={value} onChange={onChange} diagnostics={diagnostics} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div ref={host} className="monaco-host" data-testid="monaco-host" />
      {mode === 'loading' && (
        <div className="viewport-message">
          <Spinner label="Loading code editor" />
        </div>
      )}
    </div>
  );
});
