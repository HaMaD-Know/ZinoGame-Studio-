import type { BinaryOp, Expr, Program, Stmt, TopLevel } from './ast';

/**
 * IR → Zino Script text, plus a source map from node/block ids to line
 * ranges. The printer is also used as the code formatter.
 */

export interface SourceMapEntry {
  nodeId: string;
  startLine: number;
  endLine: number;
}

export interface PrintResult {
  code: string;
  sourceMap: SourceMapEntry[];
}

const PRECEDENCE: Record<BinaryOp, number> = {
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

export function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) return '0';
  // Avoid exponent notation for typical game values while keeping precision.
  const s = String(value);
  return s;
}

export function printExpr(expr: Expr, parentPrec = 0): string {
  switch (expr.kind) {
    case 'number':
      return expr.value < 0 && parentPrec > 0 ? `(${formatNumber(expr.value)})` : formatNumber(expr.value);
    case 'string':
      return quoteString(expr.value);
    case 'boolean':
      return expr.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'identifier':
      return expr.name;
    case 'unary': {
      const inner = printExpr(expr.operand, 7);
      return `${expr.op}${inner}`;
    }
    case 'binary': {
      const prec = PRECEDENCE[expr.op];
      // Left-associative: the right side needs parentheses at equal precedence.
      const text = `${printExpr(expr.left, prec)} ${expr.op} ${printExpr(expr.right, prec + 1)}`;
      return prec < parentPrec ? `(${text})` : text;
    }
    case 'call':
      return `${expr.callee}(${expr.args.map((a) => printExpr(a)).join(', ')})`;
  }
}

class Printer {
  private lines: string[] = [];
  readonly sourceMap: SourceMapEntry[] = [];

  private emit(indent: number, text: string): void {
    this.lines.push(`${'  '.repeat(indent)}${text}`);
  }

  private get lineNo(): number {
    return this.lines.length;
  }

  private map(id: string | undefined, startLine: number): void {
    if (id) this.sourceMap.push({ nodeId: id, startLine, endLine: this.lineNo });
  }

  private comment(node: Extract<Stmt, { kind: 'comment' }>, indent: number): void {
    if (node.trailing && this.lines.length > 0 && !node.block) {
      const last = this.lines.length - 1;
      const prev = this.lines[last] as string;
      if (!prev.trimEnd().endsWith('{') && prev.trim() !== '') {
        this.lines[last] = `${prev} // ${node.text}`;
        this.map(node.id, this.lineNo);
        return;
      }
    }
    const start = this.lineNo + 1;
    if (node.block) {
      const parts = node.text.split('\n');
      if (parts.length === 1) this.emit(indent, `/* ${node.text} */`);
      else {
        this.emit(indent, '/*');
        for (const p of parts) this.emit(indent, ` ${p.trim()}`.trimEnd());
        this.emit(indent, '*/');
      }
    } else {
      for (const p of node.text.split('\n')) this.emit(indent, `// ${p}`.trimEnd());
    }
    this.map(node.id, start);
  }

  block(body: Stmt[], indent: number): void {
    for (const stmt of body) this.stmt(stmt, indent);
  }

  stmt(s: Stmt, indent: number): void {
    if (s.kind === 'comment') {
      this.comment(s, indent);
      return;
    }
    const start = this.lineNo + 1;
    switch (s.kind) {
      case 'let':
        this.emit(indent, `let ${s.name} = ${printExpr(s.init)}`);
        break;
      case 'assign':
        this.emit(indent, `${s.name} ${s.op} ${printExpr(s.value)}`);
        break;
      case 'expr':
        this.emit(indent, printExpr(s.expr));
        break;
      case 'return':
        this.emit(indent, s.value ? `return ${printExpr(s.value)}` : 'return');
        break;
      case 'break':
      case 'continue':
        this.emit(indent, s.kind);
        break;
      case 'repeat':
        this.emit(indent, `repeat (${printExpr(s.count)}) {`);
        this.block(s.body, indent + 1);
        this.emit(indent, '}');
        break;
      case 'while':
        this.emit(indent, `while (${printExpr(s.test)}) {`);
        this.block(s.body, indent + 1);
        this.emit(indent, '}');
        break;
      case 'if':
        this.ifChain(s, indent, '');
        break;
    }
    this.map(s.id, start);
  }

  private ifChain(s: Extract<Stmt, { kind: 'if' }>, indent: number, prefix: string): void {
    this.emit(indent, `${prefix}if (${printExpr(s.test)}) {`);
    this.block(s.then, indent + 1);
    if (!s.else) {
      this.emit(indent, '}');
      return;
    }
    const only = s.else.length === 1 ? s.else[0] : undefined;
    if (only && only.kind === 'if') {
      // `else if` chain: the nested if closes the previous brace on its first line.
      const start = this.lineNo + 1;
      this.ifChain(only, indent, '} else ');
      this.map(only.id, start);
      return;
    }
    this.emit(indent, '} else {');
    this.block(s.else, indent + 1);
    this.emit(indent, '}');
  }

  topLevel(node: TopLevel, gapBefore: boolean): void {
    if (gapBefore) this.lines.push('');
    if (node.kind === 'comment') {
      this.comment(node, 0);
      return;
    }
    const start = this.lineNo + 1;
    switch (node.kind) {
      case 'var':
        this.emit(0, `var ${node.name} = ${printExpr(node.init)}`);
        break;
      case 'event': {
        const head = node.event === 'button' ? `on button(${quoteString(node.button ?? 'jump')})` : `on ${node.event}`;
        this.emit(0, `${head} {`);
        this.block(node.body, 1);
        this.emit(0, '}');
        break;
      }
      case 'function':
        this.emit(0, `function ${node.name}(${node.params.join(', ')}) {`);
        this.block(node.body, 1);
        this.emit(0, '}');
        break;
    }
    this.map(node.id, start);
  }

  result(): string {
    return this.lines.join('\n') + (this.lines.length ? '\n' : '');
  }
}

export function printProgram(program: Program): PrintResult {
  const p = new Printer();
  program.body.forEach((node, i) => {
    const prev = i > 0 ? program.body[i - 1] : undefined;
    let gap = false;
    if (prev) {
      const prevIsBlock = prev.kind === 'event' || prev.kind === 'function';
      if (node.kind === 'comment') gap = !node.trailing && prevIsBlock;
      else if (node.kind === 'event' || node.kind === 'function') gap = prev.kind !== 'comment';
      else gap = prevIsBlock;
    }
    p.topLevel(node, gap);
  });
  return { code: p.result(), sourceMap: p.sourceMap };
}

/** Finds the node id whose mapped line range contains `line` (innermost wins). */
export function nodeAtLine(sourceMap: SourceMapEntry[], line: number): string | null {
  let best: SourceMapEntry | null = null;
  for (const e of sourceMap) {
    if (line < e.startLine || line > e.endLine) continue;
    if (!best || e.endLine - e.startLine < best.endLine - best.startLine) best = e;
  }
  return best?.nodeId ?? null;
}

export function linesForNode(sourceMap: SourceMapEntry[], nodeId: string): SourceMapEntry | null {
  return sourceMap.find((e) => e.nodeId === nodeId) ?? null;
}
