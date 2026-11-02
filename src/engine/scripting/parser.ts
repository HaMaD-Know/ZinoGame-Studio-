import {
  ZINO_IR_VERSION,
  type AssignOp,
  type BinaryOp,
  type CommentStmt,
  type Diagnostic,
  type EventName,
  type Expr,
  type Program,
  type SourceLoc,
  type Stmt,
  type TopLevel,
} from './ast';
import { LexError, tokenize, type CommentToken, type Token } from './lexer';

/**
 * Recursive-descent parser for Zino Script.
 *
 * Statements end at a newline, `;` or `}`. Binary operators must be on the
 * same line as their left operand (unless inside parentheses), which avoids
 * JavaScript-style automatic-semicolon surprises.
 */

class ParseError extends Error {
  constructor(
    message: string,
    readonly token: Token,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);
const MAX_NESTING = 64;

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

function describe(token: Token): string {
  if (token.type === 'eof') return 'the end of the script';
  if (token.type === 'string') return 'text';
  return `"${token.value}"`;
}

class Parser {
  private pos = 0;
  private commentPos = 0;
  private parenDepth = 0;
  private nesting = 0;
  readonly diagnostics: Diagnostic[] = [];
  private lastToken: Token | null = null;

  constructor(
    private readonly tokens: Token[],
    private readonly comments: CommentToken[],
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    this.lastToken = t;
    return t;
  }

  private is(value: string, type?: Token['type']): boolean {
    const t = this.peek();
    return t.value === value && (type ? t.type === type : t.type === 'punct' || t.type === 'keyword');
  }

  private expect(value: string, message?: string, hint?: string): Token {
    if (this.is(value)) return this.next();
    const t = this.peek();
    throw new ParseError(message ?? `Expected "${value}" but found ${describe(t)}`, t, hint);
  }

  private loc(start: Token, end: Token | null = this.lastToken): SourceLoc {
    const e = end ?? start;
    return { line: start.line, column: start.column, endLine: e.endLine, endColumn: e.endColumn };
  }

  /** Emits comment nodes for all comments that start before `offset`. */
  private takeComments(beforeOffset: number, trailingLine: number | null): CommentStmt[] {
    const out: CommentStmt[] = [];
    while (this.commentPos < this.comments.length) {
      const c = this.comments[this.commentPos] as CommentToken;
      if (c.offset >= beforeOffset) break;
      this.commentPos++;
      const node: CommentStmt = {
        kind: 'comment',
        text: c.text,
        loc: { line: c.line, column: c.column, endLine: c.endLine, endColumn: c.endColumn },
      };
      if (c.block) node.block = true;
      if (trailingLine !== null && c.line === trailingLine) node.trailing = true;
      out.push(node);
    }
    return out;
  }

  private endStatement(): void {
    const t = this.peek();
    if (this.is(';')) {
      this.next();
      return;
    }
    if (t.type === 'eof' || this.is('}') || t.newlineBefore) return;
    throw new ParseError(
      `Expected a new line after this statement but found ${describe(t)}`,
      t,
      'Put each statement on its own line, or separate them with ";".',
    );
  }

  private recover(startPos: number): void {
    // Skip to the next token that starts a new line or closes a block, always
    // making progress so a bad token can never cause an endless loop.
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      const moved = this.pos > startPos;
      if (moved && (t.newlineBefore || this.is('}'))) return;
      if (!moved && this.is('}') && this.nesting > 0) return;
      this.next();
    }
  }

  private report(err: unknown): void {
    if (err instanceof ParseError) {
      const t = err.token;
      this.diagnostics.push({
        severity: 'error',
        message: err.message,
        loc: { line: t.line, column: t.column, endLine: t.endLine, endColumn: Math.max(t.endColumn, t.column + 1) },
        hint: err.hint,
      });
    } else {
      throw err;
    }
  }

  parseProgram(): Program {
    const body: TopLevel[] = [];
    while (this.peek().type !== 'eof') {
      body.push(...this.takeComments(this.peek().offset, this.lastToken?.endLine ?? null));
      const saved = { nesting: this.nesting, paren: this.parenDepth, pos: this.pos };
      try {
        body.push(this.parseTopLevel());
      } catch (err) {
        this.report(err);
        this.nesting = saved.nesting;
        this.parenDepth = saved.paren;
        this.recover(saved.pos);
      }
    }
    body.push(...this.takeComments(Infinity, this.lastToken?.endLine ?? null));
    return { irVersion: ZINO_IR_VERSION, body };
  }

  private parseTopLevel(): TopLevel {
    const t = this.peek();
    if (t.type === 'keyword' && t.value === 'on') return this.parseEvent();
    if (t.type === 'keyword' && t.value === 'var') {
      const start = this.next();
      const { name, init } = this.parseDeclarationRest();
      this.endStatement();
      return { kind: 'var', name, init, loc: this.loc(start) };
    }
    if (t.type === 'keyword' && t.value === 'function') return this.parseFunction();
    throw new ParseError(
      `Code must be inside an event like "on start { ... }" (found ${describe(t)})`,
      t,
      'Wrap your code in an event block, for example:\non start {\n  ...\n}',
    );
  }

  private parseEvent(): TopLevel {
    const start = this.next(); // on
    const nameTok = this.next();
    if (nameTok.type !== 'identifier' || !['start', 'update', 'collision', 'button'].includes(nameTok.value)) {
      throw new ParseError(
        `Unknown event "${nameTok.value}". Use start, update, collision or button.`,
        nameTok,
      );
    }
    const event = nameTok.value as EventName;
    let button: string | null = null;
    if (event === 'button') {
      this.expect('(', 'Button events need a button name, like on button("jump")');
      const b = this.next();
      if (b.type !== 'string') throw new ParseError('Button name must be text, like "jump"', b);
      button = String(b.literal);
      this.expect(')');
    } else if (this.is('(')) {
      // Allow `on update()` for people used to function syntax.
      this.next();
      this.expect(')', `The ${event} event does not take parameters`);
    }
    const body = this.parseBlock();
    return { kind: 'event', event, button, body, loc: this.loc(start) };
  }

  private parseFunction(): TopLevel {
    const start = this.next();
    const nameTok = this.next();
    if (nameTok.type !== 'identifier') throw new ParseError('Expected a function name', nameTok);
    this.expect('(');
    const params: string[] = [];
    if (!this.is(')')) {
      do {
        const p = this.next();
        if (p.type !== 'identifier') throw new ParseError('Expected a parameter name', p);
        params.push(p.value);
      } while (this.is(',') && this.next());
    }
    this.expect(')');
    const body = this.parseBlock();
    return { kind: 'function', name: nameTok.value, params, body, loc: this.loc(start) };
  }

  private parseBlock(): Stmt[] {
    this.expect('{', undefined, 'Code blocks start with "{" and end with "}".');
    if (++this.nesting > MAX_NESTING) throw new ParseError('Code is nested too deeply', this.peek());
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.peek().type === 'eof') {
        this.nesting--;
        throw new ParseError('Missing "}" to close this block', this.peek());
      }
      body.push(...this.takeComments(this.peek().offset, this.lastToken?.endLine ?? null));
      if (this.is('}')) break;
      const saved = { nesting: this.nesting, paren: this.parenDepth, pos: this.pos };
      try {
        body.push(this.parseStatement());
      } catch (err) {
        this.report(err);
        this.nesting = saved.nesting;
        this.parenDepth = saved.paren;
        this.recover(saved.pos);
      }
    }
    body.push(...this.takeComments(this.peek().offset, this.lastToken?.endLine ?? null));
    this.expect('}');
    this.nesting--;
    return body;
  }

  private parseDeclarationRest(): { name: string; init: Expr } {
    const nameTok = this.next();
    if (nameTok.type !== 'identifier') {
      throw new ParseError(`Expected a variable name but found ${describe(nameTok)}`, nameTok);
    }
    this.expect('=', `Give "${nameTok.value}" a starting value, like ${nameTok.value} = 0`);
    return { name: nameTok.value, init: this.parseExpression() };
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'let':
        case 'var': {
          this.next();
          const { name, init } = this.parseDeclarationRest();
          this.endStatement();
          return { kind: 'let', name, init, loc: this.loc(t) };
        }
        case 'if':
          return this.parseIf();
        case 'repeat': {
          this.next();
          this.expect('(', 'Write repeat like this: repeat (3) { ... }');
          this.parenDepth++;
          const count = this.parseExpression();
          this.parenDepth--;
          this.expect(')');
          const body = this.parseBlock();
          return { kind: 'repeat', count, body, loc: this.loc(t) };
        }
        case 'while': {
          this.next();
          this.expect('(', 'Write while like this: while (x < 10) { ... }');
          this.parenDepth++;
          const test = this.parseExpression();
          this.parenDepth--;
          this.expect(')');
          const body = this.parseBlock();
          return { kind: 'while', test, body, loc: this.loc(t) };
        }
        case 'return': {
          this.next();
          let value: Expr | null = null;
          const n = this.peek();
          if (!(n.type === 'eof' || n.newlineBefore || this.is('}') || this.is(';'))) value = this.parseExpression();
          this.endStatement();
          return { kind: 'return', value, loc: this.loc(t) };
        }
        case 'break':
        case 'continue':
          this.next();
          this.endStatement();
          return { kind: t.value, loc: this.loc(t) };
        case 'on':
          throw new ParseError('Events cannot be placed inside other code', t, 'Move this "on" block to the top level.');
        case 'function':
          throw new ParseError('Functions must be declared at the top level', t);
      }
    }
    if (t.type === 'identifier' && this.peek(1).type === 'punct' && ASSIGN_OPS.has(this.peek(1).value)) {
      this.next();
      const op = this.next().value as AssignOp;
      const value = this.parseExpression();
      this.endStatement();
      return { kind: 'assign', name: t.value, op, value, loc: this.loc(t) };
    }
    const expr = this.parseExpression();
    if (expr.kind !== 'call') {
      throw new ParseError(
        'This line does nothing. Did you mean to call an action or set a variable?',
        t,
      );
    }
    this.endStatement();
    return { kind: 'expr', expr, loc: this.loc(t) };
  }

  private parseIf(): Stmt {
    const start = this.next();
    this.expect('(', 'Write if like this: if (score > 10) { ... }');
    this.parenDepth++;
    const test = this.parseExpression();
    this.parenDepth--;
    this.expect(')');
    const then = this.parseBlock();
    let otherwise: Stmt[] | null = null;
    if (this.is('else')) {
      this.next();
      if (this.is('if')) otherwise = [this.parseIf()];
      else otherwise = this.parseBlock();
    }
    return { kind: 'if', test, then, else: otherwise, loc: this.loc(start) };
  }

  private parseExpression(minPrec = 1): Expr {
    if (++this.nesting > MAX_NESTING) throw new ParseError('Expression is nested too deeply', this.peek());
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const prec = t.type === 'punct' ? PRECEDENCE[t.value] : undefined;
      if (prec === undefined || prec < minPrec) break;
      if (t.newlineBefore && this.parenDepth === 0) break;
      this.next();
      const right = this.parseExpression(prec + 1);
      left = {
        kind: 'binary',
        op: t.value as BinaryOp,
        left,
        right,
        loc: {
          line: left.loc?.line ?? t.line,
          column: left.loc?.column ?? t.column,
          endLine: right.loc?.endLine ?? t.endLine,
          endColumn: right.loc?.endColumn ?? t.endColumn,
        },
      };
    }
    this.nesting--;
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'punct' && (t.value === '-' || t.value === '!')) {
      this.next();
      const operand = this.parseUnary();
      // Fold negative number literals so "-5" stays a simple number.
      if (t.value === '-' && operand.kind === 'number') {
        return { kind: 'number', value: -operand.value, loc: this.loc(t) };
      }
      return { kind: 'unary', op: t.value, operand, loc: this.loc(t) };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'number':
        return { kind: 'number', value: t.literal as number, loc: this.loc(t) };
      case 'string':
        return { kind: 'string', value: t.literal as string, loc: this.loc(t) };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          return { kind: 'boolean', value: t.value === 'true', loc: this.loc(t) };
        }
        if (t.value === 'null') return { kind: 'null', loc: this.loc(t) };
        throw new ParseError(`"${t.value}" cannot be used here`, t);
      case 'identifier': {
        if (this.is('(')) {
          this.next();
          this.parenDepth++;
          const args: Expr[] = [];
          if (!this.is(')')) {
            do {
              args.push(this.parseExpression());
            } while (this.is(',') && this.next());
          }
          this.parenDepth--;
          this.expect(')', `Missing ")" after the values for ${t.value}(...)`);
          return { kind: 'call', callee: t.value, args, loc: this.loc(t) };
        }
        if (this.is('.')) {
          throw new ParseError(
            'Zino Script does not use "." to read values',
            this.peek(),
            'Use functions like getX(self) instead of self.x.',
          );
        }
        return { kind: 'identifier', name: t.value, loc: this.loc(t) };
      }
      case 'punct':
        if (t.value === '(') {
          this.parenDepth++;
          const inner = this.parseExpression();
          this.parenDepth--;
          this.expect(')', 'Missing ")"');
          return inner;
        }
        throw new ParseError(`Unexpected ${describe(t)}`, t);
      default:
        throw new ParseError(`Expected a value but found ${describe(t)}`, t);
    }
  }
}

export function parse(source: string): ParseResult {
  let lexed;
  try {
    lexed = tokenize(source);
  } catch (err) {
    if (err instanceof LexError) {
      return {
        program: { irVersion: ZINO_IR_VERSION, body: [] },
        diagnostics: [
          {
            severity: 'error',
            message: err.message,
            loc: { line: err.line, column: err.column, endLine: err.line, endColumn: err.column + 1 },
          },
        ],
      };
    }
    throw err;
  }
  const parser = new Parser(lexed.tokens, lexed.comments);
  const program = parser.parseProgram();
  return { program, diagnostics: parser.diagnostics };
}
