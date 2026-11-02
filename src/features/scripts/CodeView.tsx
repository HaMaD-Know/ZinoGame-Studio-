import { useEffect, useMemo, useRef } from 'react';
import { BUILTIN_MAP } from '../../engine/scripting/api';
import { KEYWORDS } from '../../engine/scripting/lexer';

/**
 * Read-only, syntax-highlighted code with optional highlighted lines.
 * Highlighting is a small regex tokenizer (display only; never executed).
 */

type Tok = { text: string; cls?: string };

export function highlightLine(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\/\/.*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: line.slice(last, i) });
    const t = m[0];
    let cls: string | undefined;
    if (t.startsWith('//') || t.startsWith('/*')) cls = 'tok-comment';
    else if (t.startsWith('"') || t.startsWith("'")) cls = 'tok-string';
    else if (/^\d/.test(t)) cls = 'tok-number';
    else if (KEYWORDS.has(t)) cls = 'tok-keyword';
    else if (BUILTIN_MAP.has(t) || t === 'self' || t === 'other' || t === 'dt') cls = 'tok-builtin';
    out.push({ text: t, cls });
    last = i + t.length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export function CodeView({
  code,
  highlight,
  onLineClick,
  label,
}: {
  code: string;
  highlight?: { start: number; end: number } | null;
  onLineClick?: (line: number) => void;
  label: string;
}) {
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!highlight) return;
    ref.current?.querySelector(`[data-line="${highlight.start}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  return (
    <pre className="code-lines" ref={ref} aria-label={label} tabIndex={0}>
      {lines.map((line, i) => {
        const n = i + 1;
        const on = !!highlight && n >= highlight.start && n <= highlight.end;
        return (
          <div key={i} className="code-line" data-line={n} data-highlight={on} onClick={() => onLineClick?.(n)}>
            <span className="ln">{n}</span>
            <span className="src">
              {highlightLine(line).map((t, j) => (
                <span key={j} className={t.cls}>
                  {t.text}
                </span>
              ))}
              {line === '' ? ' ' : null}
            </span>
          </div>
        );
      })}
    </pre>
  );
}
