/**
 * Zino Script lexer. Produces tokens plus a separate list of comments so the
 * parser can preserve comments as IR nodes instead of discarding them.
 */

export type TokenType = 'number' | 'string' | 'identifier' | 'keyword' | 'punct' | 'eof';

export const KEYWORDS = new Set([
  'on', 'var', 'let', 'if', 'else', 'repeat', 'while', 'function', 'return', 'break', 'continue',
  'true', 'false', 'null',
]);

export interface Token {
  type: TokenType;
  value: string;
  /** Parsed numeric value for number tokens / decoded value for strings. */
  literal?: string | number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  offset: number;
  /** A newline appeared between the previous token and this one. */
  newlineBefore: boolean;
}

export interface CommentToken {
  text: string;
  block: boolean;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  offset: number;
}

export class LexError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'LexError';
  }
}

const PUNCTUATION = [
  '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=',
  '{', '}', '(', ')', ',', ';', '+', '-', '*', '/', '%', '<', '>', '=', '!', '.',
];

export const MAX_SOURCE_LENGTH = 200_000;

export function tokenize(source: string): { tokens: Token[]; comments: CommentToken[] } {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new LexError(`Script is too long (max ${MAX_SOURCE_LENGTH} characters)`, 1, 1);
  }
  const tokens: Token[] = [];
  const comments: CommentToken[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let newlineBefore = false;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '\n') {
      newlineBefore = true;
      advance();
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '﻿') {
      advance();
      continue;
    }
    const startLine = line;
    const startCol = col;
    const startOffset = i;

    // Comments
    if (ch === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      const text = source.slice(i + 2, end).replace(/\r$/, '');
      advance(end - i);
      comments.push({
        text: text.startsWith(' ') ? text.slice(1) : text,
        block: false,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        offset: startOffset,
      });
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new LexError('This comment is never closed. Add */ at the end.', startLine, startCol);
      const text = source.slice(i + 2, end);
      advance(end + 2 - i);
      comments.push({
        text: text.trim(),
        block: true,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        offset: startOffset,
      });
      continue;
    }

    const push = (type: TokenType, value: string, literal?: string | number) => {
      tokens.push({
        type,
        value,
        literal,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        offset: startOffset,
        newlineBefore,
      });
      newlineBefore = false;
    };

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(source.slice(i));
      const text = m?.[0] ?? ch;
      advance(text.length);
      if (/[A-Za-z_]/.test(source[i] ?? '')) {
        throw new LexError(`"${text}${source[i]}" is not a valid number`, startLine, startCol);
      }
      push('number', text, Number(text));
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      const text = m?.[0] ?? ch;
      advance(text.length);
      push(KEYWORDS.has(text) ? 'keyword' : 'identifier', text);
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      advance();
      let closed = false;
      while (i < source.length) {
        const c = source[i] as string;
        if (c === '\n') break;
        if (c === quote) {
          advance();
          closed = true;
          break;
        }
        if (c === '\\') {
          const next = source[i + 1];
          const escapes: Record<string, string> = { n: '\n', t: '\t', '"': '"', "'": "'", '\\': '\\' };
          if (next !== undefined && escapes[next] !== undefined) {
            value += escapes[next];
            advance(2);
            continue;
          }
          throw new LexError(`Unknown escape "\\${next ?? ''}" in text`, line, col);
        }
        value += c;
        advance();
      }
      if (!closed) throw new LexError('This text is missing its closing quote', startLine, startCol);
      push('string', source.slice(startOffset, i), value);
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      advance(punct.length);
      push('punct', punct);
      continue;
    }

    throw new LexError(`Unexpected character "${ch}"`, startLine, startCol);
  }

  tokens.push({
    type: 'eof',
    value: '',
    line,
    column: col,
    endLine: line,
    endColumn: col,
    offset: source.length,
    newlineBefore: true,
  });
  return { tokens, comments };
}
