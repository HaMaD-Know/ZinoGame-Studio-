import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Diagnostic } from '../../engine/scripting/ast';

export interface CodeEditorHandle {
  revealLine: (line: number) => void;
  getValue: () => string;
  setValue: (v: string) => void;
}

/**
 * Lightweight code editor used when Monaco is unavailable or on touch-only
 * devices: a plain textarea with line numbers, error markers, Tab indent and
 * auto-indent. Text is never altered except by the user.
 */
export const SimpleCodeEditor = forwardRef<CodeEditorHandle, { value: string; onChange: (v: string) => void; diagnostics: Diagnostic[]; readOnly?: boolean }>(
  function SimpleCodeEditor({ value, onChange, diagnostics, readOnly }, ref) {
    const area = useRef<HTMLTextAreaElement>(null);
    const gutter = useRef<HTMLDivElement>(null);
    const [text, setText] = useState(value);
    const lines = text.split('\n').length;
    const errorLines = new Set(diagnostics.filter((d) => d.severity === 'error' && d.loc).map((d) => d.loc!.line));

    const update = (v: string) => {
      setText(v);
      onChange(v);
    };

    useImperativeHandle(ref, () => ({
      revealLine: (line) => {
        const el = area.current;
        if (!el) return;
        const offsets = text.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
        el.focus();
        el.setSelectionRange(offsets, offsets);
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
        el.scrollTop = Math.max(0, (line - 4) * lineHeight);
      },
      getValue: () => text,
      setValue: (v) => setText(v),
    }));

    return (
      <div className="simple-editor" data-testid="simple-code-editor">
        <div className="gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} data-error={errorLines.has(i + 1)}>
              {errorLines.has(i + 1) ? '●' : i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Script code"
          wrap="off"
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === 'Tab') {
              e.preventDefault();
              const { selectionStart: s, selectionEnd: end } = el;
              const v = `${text.slice(0, s)}  ${text.slice(end)}`;
              update(v);
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const s = el.selectionStart;
              const lineStart = text.lastIndexOf('\n', s - 1) + 1;
              const indent = /^\s*/.exec(text.slice(lineStart, s))?.[0] ?? '';
              const extra = text.slice(0, s).trimEnd().endsWith('{') ? '  ' : '';
              const insert = `\n${indent}${extra}`;
              update(`${text.slice(0, s)}${insert}${text.slice(el.selectionEnd)}`);
              requestAnimationFrame(() => el.setSelectionRange(s + insert.length, s + insert.length));
            }
          }}
        />
      </div>
    );
  },
);
