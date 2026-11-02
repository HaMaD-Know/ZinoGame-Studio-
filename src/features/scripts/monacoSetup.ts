import { BUILTINS, EVENT_DOCS, IMPLICIT_VARIABLES, NAMED_BUTTONS } from '../../engine/scripting/api';

/**
 * Lazily loads Monaco with only the core editor (no bundled languages) and
 * registers the Zino Script language: tokens, completion, hover docs.
 * Uses a bundled web worker, so it works offline inside the iOS app.
 */

type Monaco = typeof import('monaco-editor/esm/vs/editor/editor.api.js');
let loading: Promise<Monaco> | null = null;

export const ZINO_LANGUAGE_ID = 'zino';

export function loadMonaco(timeoutMs = 15000): Promise<Monaco> {
  if (!loading) {
    loading = (async () => {
      const [{ default: EditorWorker }] = await Promise.all([import('monaco-editor/esm/vs/editor/editor.worker.js?worker')]);
      (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
        getWorker: () => new EditorWorker(),
      };
      await import('monaco-editor/esm/vs/editor/editor.all.js');
      const monaco = (await import('monaco-editor/esm/vs/editor/editor.api.js')) as Monaco;
      register(monaco);
      return monaco;
    })();
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The code editor took too long to load')), timeoutMs));
    loading = Promise.race([loading, timeout]).catch((err: unknown) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

function register(monaco: Monaco): void {
  if (monaco.languages.getLanguages().some((l) => l.id === ZINO_LANGUAGE_ID)) return;
  monaco.languages.register({ id: ZINO_LANGUAGE_ID, extensions: ['.zs'], aliases: ['Zino Script'] });
  monaco.languages.setMonarchTokensProvider(ZINO_LANGUAGE_ID, {
    keywords: ['on', 'var', 'let', 'if', 'else', 'repeat', 'while', 'function', 'return', 'break', 'continue', 'true', 'false', 'null'],
    builtins: [...BUILTINS.map((b) => b.name), 'self', 'other', 'dt', 'start', 'update', 'collision', 'button'],
    tokenizer: {
      root: [
        [/[A-Za-z_][\w]*/, { cases: { '@keywords': 'keyword', '@builtins': 'type.identifier', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_dq'],
        [/'/, 'string', '@string_sq'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/[{}()]/, '@brackets'],
        [/[+\-*/%=<>!&|]+/, 'operator'],
      ],
      string_dq: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
      string_sq: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration(ZINO_LANGUAGE_ID, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    indentationRules: { increaseIndentPattern: /\{\s*$/, decreaseIndentPattern: /^\s*\}/ },
  });
  monaco.languages.registerCompletionItemProvider(ZINO_LANGUAGE_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const K = monaco.languages.CompletionItemKind;
      const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const suggestions = [
        ...BUILTINS.map((b) => ({
          label: b.name,
          kind: K.Function,
          detail: `${b.name}(${b.params.map((p) => p.name).join(', ')})`,
          documentation: `${b.doc}\n\nExample: ${b.example}`,
          insertText: `${b.name}(${b.params.map((p, i) => `\${${i + 1}:${p.name === 'object' ? 'self' : p.name}}`).join(', ')})`,
          insertTextRules: R,
          range,
        })),
        ...IMPLICIT_VARIABLES.map((v) => ({ label: v.name, kind: K.Variable, documentation: v.doc, insertText: v.name, range })),
        ...(['start', 'update', 'collision'] as const).map((ev) => ({
          label: `on ${ev}`,
          kind: K.Snippet,
          documentation: EVENT_DOCS[ev],
          insertText: `on ${ev} {\n\t$0\n}`,
          insertTextRules: R,
          range,
        })),
        {
          label: 'on button',
          kind: K.Snippet,
          documentation: `${EVENT_DOCS.button} Buttons: ${NAMED_BUTTONS.map((b) => b.name).join(', ')}`,
          insertText: 'on button("${1:jump}") {\n\t$0\n}',
          insertTextRules: R,
          range,
        },
        { label: 'if', kind: K.Snippet, insertText: 'if (${1:condition}) {\n\t$0\n}', insertTextRules: R, range },
        { label: 'repeat', kind: K.Snippet, insertText: 'repeat (${1:3}) {\n\t$0\n}', insertTextRules: R, range },
        { label: 'while', kind: K.Snippet, insertText: 'while (${1:condition}) {\n\t$0\n}', insertTextRules: R, range },
        { label: 'var', kind: K.Keyword, insertText: 'var ${1:name} = ${2:0}', insertTextRules: R, range },
        { label: 'let', kind: K.Keyword, insertText: 'let ${1:name} = ${2:0}', insertTextRules: R, range },
      ];
      return { suggestions };
    },
  });
  monaco.languages.registerHoverProvider(ZINO_LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const b = BUILTINS.find((x) => x.name === word.word);
      const v = IMPLICIT_VARIABLES.find((x) => x.name === word.word);
      if (!b && !v) return null;
      return {
        contents: b
          ? [{ value: `**${b.name}**(${b.params.map((p) => p.name).join(', ')})` }, { value: b.doc }, { value: `\`${b.example}\`` }]
          : [{ value: `**${v!.name}**` }, { value: v!.doc }],
      };
    },
  });
}
