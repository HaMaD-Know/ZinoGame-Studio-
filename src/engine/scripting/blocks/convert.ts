import { createId } from '../../core/ids';
import {
  ZINO_IR_VERSION,
  type AssignOp,
  type BinaryOp,
  type Diagnostic,
  type Expr,
  type Program,
  type Stmt,
  type TopLevel,
} from '../ast';
import { isValidButtonName } from '../api';
import { EVENT_BLOCK_TYPES } from './definitions';

/**
 * Conversion between Blockly's JSON serialisation format and the Zino IR.
 *
 * Works on plain JSON, so it runs (and is tested) without Blockly or a DOM.
 * IR nodes produced from blocks carry the block id, which is what links
 * blocks to lines of generated code (see printer.ts source maps).
 */

export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockState; shadow?: BlockState }>;
  next?: { block?: BlockState; shadow?: BlockState };
  icons?: { comment?: { text?: string } };
  [key: string]: unknown;
}

export interface WorkspaceState {
  blocks?: { languageVersion?: number; blocks?: BlockState[] };
  [key: string]: unknown;
}

export interface BlocksToProgramResult {
  program: Program;
  diagnostics: Diagnostic[];
  /** Top-level blocks that are not inside an event and therefore do not run. */
  looseBlockIds: string[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VECTOR_BLOCKS: Record<string, string> = {
  zino_move: 'move',
  zino_rotate: 'rotate',
  zino_set_position: 'setPosition',
  zino_set_rotation: 'setRotation',
  zino_apply_force: 'applyForce',
};
const SINGLE_ARG_STATEMENTS: Record<string, { callee: string; input: string; fallback: () => Expr }> = {
  zino_destroy: { callee: 'destroy', input: 'OBJ', fallback: () => ({ kind: 'identifier', name: 'self' }) },
  zino_show_message: { callee: 'showMessage', input: 'TEXT', fallback: () => ({ kind: 'string', value: '' }) },
  zino_add_score: { callee: 'addScore', input: 'AMOUNT', fallback: () => ({ kind: 'number', value: 1 }) },
  zino_set_score: { callee: 'setScore', input: 'AMOUNT', fallback: () => ({ kind: 'number', value: 0 }) },
  zino_play_sound: { callee: 'playSound', input: 'NAME', fallback: () => ({ kind: 'string', value: 'beep' }) },
  zino_log: { callee: 'log', input: 'VALUE', fallback: () => ({ kind: 'string', value: '' }) },
};
const BINARY_OPS = new Set<BinaryOp>(['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||']);
const ASSIGN_OPS = new Set<AssignOp>(['+=', '-=', '*=', '/=']);

function readBlocks(state: unknown): BlockState[] {
  if (!state || typeof state !== 'object') return [];
  const blocks = (state as WorkspaceState).blocks?.blocks;
  return Array.isArray(blocks) ? blocks.filter((b): b is BlockState => !!b && typeof b === 'object' && typeof b.type === 'string') : [];
}

class BlocksReader {
  readonly diagnostics: Diagnostic[] = [];

  private warn(block: BlockState, message: string, hint?: string) {
    this.diagnostics.push({ severity: 'warning', message, nodeId: block.id, hint });
  }

  private error(block: BlockState, message: string, hint?: string) {
    this.diagnostics.push({ severity: 'error', message, nodeId: block.id, hint });
  }

  private field(block: BlockState, name: string): unknown {
    return block.fields?.[name];
  }

  private input(block: BlockState, name: string): BlockState | undefined {
    const slot = block.inputs?.[name];
    return slot?.block ?? slot?.shadow;
  }

  private value(block: BlockState, name: string, fallback: () => Expr, what: string): Expr {
    const child = this.input(block, name);
    if (!child) {
      this.warn(block, `A "${what}" slot is empty, so a default value is used`, 'Drag a value block into the empty slot.');
      return fallback();
    }
    return this.expr(child);
  }

  private varName(block: BlockState): string {
    const raw = this.field(block, 'NAME');
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!IDENT.test(name)) {
      this.error(block, `"${name}" is not a valid variable name`, 'Use letters, numbers and _ only, starting with a letter.');
      return name || 'unnamed';
    }
    return name;
  }

  expr(b: BlockState): Expr {
    const id = b.id;
    const zero = (): Expr => ({ kind: 'number', value: 0 });
    switch (b.type) {
      case 'zino_number': {
        const v = Number(this.field(b, 'NUM'));
        return { kind: 'number', value: Number.isFinite(v) ? v : 0, id };
      }
      case 'zino_text':
        return { kind: 'string', value: String(this.field(b, 'TEXT') ?? ''), id };
      case 'zino_boolean':
        return { kind: 'boolean', value: this.field(b, 'BOOL') !== 'FALSE', id };
      case 'zino_var_get':
        return { kind: 'identifier', name: this.varName(b), id };
      case 'zino_self':
        return { kind: 'identifier', name: 'self', id };
      case 'zino_other':
        return { kind: 'identifier', name: 'other', id };
      case 'zino_dt':
        return { kind: 'identifier', name: 'dt', id };
      case 'zino_get_score':
        return { kind: 'call', callee: 'getScore', args: [], id };
      case 'zino_arith':
      case 'zino_compare':
      case 'zino_logic': {
        const op = String(this.field(b, 'OP')) as BinaryOp;
        if (!BINARY_OPS.has(op)) {
          this.error(b, `Unknown operator "${op}"`);
        }
        const fallback = b.type === 'zino_logic' ? (): Expr => ({ kind: 'boolean', value: false }) : zero;
        return {
          kind: 'binary',
          op: BINARY_OPS.has(op) ? op : '+',
          left: this.value(b, 'A', fallback, 'left'),
          right: this.value(b, 'B', fallback, 'right'),
          id,
        };
      }
      case 'zino_not':
        return { kind: 'unary', op: '!', operand: this.value(b, 'VALUE', () => ({ kind: 'boolean', value: false }), 'value'), id };
      case 'zino_negate':
        return { kind: 'unary', op: '-', operand: this.value(b, 'VALUE', zero, 'value'), id };
      case 'zino_random':
        return {
          kind: 'call',
          callee: 'random',
          args: [this.value(b, 'MIN', zero, 'from'), this.value(b, 'MAX', () => ({ kind: 'number', value: 1 }), 'to')],
          id,
        };
      case 'zino_find':
        return { kind: 'call', callee: 'find', args: [this.value(b, 'NAME', () => ({ kind: 'string', value: '' }), 'name')], id };
      case 'zino_get_axis': {
        const axis = String(this.field(b, 'AXIS') ?? 'X');
        const callee = axis === 'Y' ? 'getY' : axis === 'Z' ? 'getZ' : 'getX';
        return { kind: 'call', callee, args: [this.value(b, 'OBJ', () => ({ kind: 'identifier', name: 'self' }), 'object')], id };
      }
      case 'zino_is_pressed':
        return { kind: 'call', callee: 'isPressed', args: [{ kind: 'string', value: String(this.field(b, 'BUTTON') ?? 'jump') }], id };
      default:
        this.error(b, `The "${b.type}" block cannot be used as a value here`);
        return { kind: 'null', id };
    }
  }

  private blockComment(b: BlockState): Stmt[] {
    const text = b.icons?.comment?.text;
    return typeof text === 'string' && text.trim() ? [{ kind: 'comment', text: text.trim(), id: `${b.id ?? 'block'}_note` }] : [];
  }

  stmt(b: BlockState): Stmt[] {
    const id = b.id;
    const pre = this.blockComment(b);
    const vector = VECTOR_BLOCKS[b.type];
    if (vector) {
      const zero = (): Expr => ({ kind: 'number', value: 0 });
      return [
        ...pre,
        {
          kind: 'expr',
          id,
          expr: {
            kind: 'call',
            callee: vector,
            id,
            args: [
              this.value(b, 'OBJ', () => ({ kind: 'identifier', name: 'self' }), 'object'),
              this.value(b, 'X', zero, 'x'),
              this.value(b, 'Y', zero, 'y'),
              this.value(b, 'Z', zero, 'z'),
            ],
          },
        },
      ];
    }
    const single = SINGLE_ARG_STATEMENTS[b.type];
    if (single) {
      return [
        ...pre,
        {
          kind: 'expr',
          id,
          expr: { kind: 'call', callee: single.callee, id, args: [this.value(b, single.input, single.fallback, single.input.toLowerCase())] },
        },
      ];
    }
    switch (b.type) {
      case 'zino_if':
        return [
          ...pre,
          {
            kind: 'if',
            id,
            test: this.value(b, 'COND', () => ({ kind: 'boolean', value: false }), 'condition'),
            then: this.chain(this.input(b, 'DO')),
            else: null,
          },
        ];
      case 'zino_if_else':
        return [
          ...pre,
          {
            kind: 'if',
            id,
            test: this.value(b, 'COND', () => ({ kind: 'boolean', value: false }), 'condition'),
            then: this.chain(this.input(b, 'DO')),
            else: this.chain(this.input(b, 'ELSE')),
          },
        ];
      case 'zino_repeat':
        return [...pre, { kind: 'repeat', id, count: this.value(b, 'TIMES', () => ({ kind: 'number', value: 1 }), 'times'), body: this.chain(this.input(b, 'DO')) }];
      case 'zino_while':
        return [
          ...pre,
          { kind: 'while', id, test: this.value(b, 'COND', () => ({ kind: 'boolean', value: false }), 'condition'), body: this.chain(this.input(b, 'DO')) },
        ];
      case 'zino_var_create':
        return [...pre, { kind: 'let', id, name: this.varName(b), init: this.value(b, 'VALUE', () => ({ kind: 'number', value: 0 }), 'value') }];
      case 'zino_var_set':
        return [...pre, { kind: 'assign', id, op: '=', name: this.varName(b), value: this.value(b, 'VALUE', () => ({ kind: 'number', value: 0 }), 'value') }];
      case 'zino_var_change': {
        const op = String(this.field(b, 'OP') ?? '+=') as AssignOp;
        return [
          ...pre,
          {
            kind: 'assign',
            id,
            op: ASSIGN_OPS.has(op) ? op : '+=',
            name: this.varName(b),
            value: this.value(b, 'VALUE', () => ({ kind: 'number', value: 1 }), 'value'),
          },
        ];
      }
      case 'zino_comment':
        return [...pre, { kind: 'comment', id, text: String(this.field(b, 'TEXT') ?? '') }];
      default:
        this.error(b, `The "${b.type}" block cannot be used as an action here`);
        return pre;
    }
  }

  chain(first: BlockState | undefined): Stmt[] {
    const out: Stmt[] = [];
    let guard = 0;
    for (let b = first; b && guard < 100_000; b = b.next?.block ?? b.next?.shadow, guard++) {
      out.push(...this.stmt(b));
    }
    return out;
  }
}

export function blocksToProgram(state: unknown): BlocksToProgramResult {
  const reader = new BlocksReader();
  const top = [...readBlocks(state)].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const body: TopLevel[] = [];
  const looseBlockIds: string[] = [];

  for (const block of top) {
    const event = EVENT_BLOCK_TYPES[block.type];
    if (event) {
      let button: string | null = null;
      if (event === 'button') {
        button = String(block.fields?.BUTTON ?? 'jump');
        if (!isValidButtonName(button)) button = 'jump';
      }
      const comment = block.icons?.comment?.text;
      if (typeof comment === 'string' && comment.trim()) body.push({ kind: 'comment', text: comment.trim(), id: `${block.id}_note` });
      body.push({ kind: 'event', id: block.id, event, button, body: reader.chain(block.inputs?.DO?.block) });
      continue;
    }
    // Chains of "create variable" and note blocks are allowed at the top level.
    let loose = false;
    for (let b: BlockState | undefined = block; b; b = b.next?.block) {
      if (b.type === 'zino_var_create') {
        const [stmt] = reader.stmt(b).filter((s) => s.kind === 'let');
        if (stmt && stmt.kind === 'let') body.push({ kind: 'var', id: stmt.id, name: stmt.name, init: stmt.init });
      } else if (b.type === 'zino_comment') {
        body.push({ kind: 'comment', id: b.id, text: String(b.fields?.TEXT ?? '') });
      } else {
        loose = true;
        break;
      }
    }
    if (loose) {
      if (block.id) looseBlockIds.push(block.id);
      reader.diagnostics.push({
        severity: 'warning',
        message: 'These blocks are not inside an event, so they will not run',
        nodeId: block.id,
        hint: 'Snap them inside a "when the game starts" or "every frame" block.',
      });
    }
  }
  return { program: { irVersion: ZINO_IR_VERSION, body }, diagnostics: reader.diagnostics, looseBlockIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// IR → blocks
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversionIssue {
  message: string;
  line?: number;
}

const STATEMENT_CALL_BLOCKS: Record<string, string> = {
  move: 'zino_move',
  rotate: 'zino_rotate',
  setPosition: 'zino_set_position',
  setRotation: 'zino_set_rotation',
  applyForce: 'zino_apply_force',
  destroy: 'zino_destroy',
  showMessage: 'zino_show_message',
  addScore: 'zino_add_score',
  setScore: 'zino_set_score',
  playSound: 'zino_play_sound',
  log: 'zino_log',
};

/**
 * Lists everything in a program that has no block equivalent. An empty list
 * means the program can be shown as blocks without losing anything.
 */
export function findUnsupportedForBlocks(program: Program): ConversionIssue[] {
  const issues: ConversionIssue[] = [];
  const add = (message: string, node: { loc?: { line: number } }) => issues.push({ message, line: node.loc?.line });

  const expr = (e: Expr): void => {
    switch (e.kind) {
      case 'null':
        add('"null" has no block yet', e);
        return;
      case 'unary':
        expr(e.operand);
        return;
      case 'binary':
        expr(e.left);
        expr(e.right);
        return;
      case 'call': {
        const valueCalls = new Set(['find', 'getX', 'getY', 'getZ', 'random', 'getScore', 'isPressed']);
        if (!valueCalls.has(e.callee)) add(`${e.callee}(...) cannot be used as a value in blocks`, e);
        if (e.callee === 'isPressed' && (e.args[0]?.kind !== 'string' || !isValidButtonName(e.args[0].value))) {
          add('isPressed needs a known button name written as text to become a block', e);
        }
        e.args.forEach(expr);
        return;
      }
      default:
        return;
    }
  };
  const stmts = (list: Stmt[]): void => list.forEach(stmt);
  const stmt = (s: Stmt): void => {
    switch (s.kind) {
      case 'let':
        expr(s.init);
        return;
      case 'assign':
        expr(s.value);
        return;
      case 'if':
        expr(s.test);
        stmts(s.then);
        if (s.else) stmts(s.else);
        return;
      case 'repeat':
        expr(s.count);
        stmts(s.body);
        return;
      case 'while':
        expr(s.test);
        stmts(s.body);
        return;
      case 'expr':
        if (s.expr.kind !== 'call' || !STATEMENT_CALL_BLOCKS[s.expr.callee]) {
          add(`${s.expr.kind === 'call' ? `${s.expr.callee}(...)` : 'This statement'} has no block yet`, s);
        }
        if (s.expr.kind === 'call') s.expr.args.forEach(expr);
        return;
      case 'return':
      case 'break':
      case 'continue':
        add(`"${s.kind}" has no block yet`, s);
        return;
      case 'comment':
        return;
    }
  };
  for (const node of program.body) {
    if (node.kind === 'function') add(`Custom function "${node.name}" has no block yet`, node);
    else if (node.kind === 'var') expr(node.init);
    else if (node.kind === 'event') stmts(node.body);
  }
  return issues;
}

class BlocksWriter {
  private used = new Set<string>();

  newId(preferred?: string): string {
    if (preferred && !this.used.has(preferred)) {
      this.used.add(preferred);
      return preferred;
    }
    let id = createId('blk', 16);
    while (this.used.has(id)) id = createId('blk', 16);
    this.used.add(id);
    return id;
  }

  /** Literal values become shadow blocks so users can drop other blocks onto them. */
  private slot(e: Expr): { block?: BlockState; shadow?: BlockState } {
    const b = this.expr(e);
    const isLiteral = e.kind === 'number' || e.kind === 'string' || (e.kind === 'identifier' && e.name === 'self');
    return isLiteral ? { shadow: b } : { block: b };
  }

  expr(e: Expr): BlockState {
    const id = this.newId(e.id);
    switch (e.kind) {
      case 'number':
        return { type: 'zino_number', id, fields: { NUM: e.value } };
      case 'string':
        return { type: 'zino_text', id, fields: { TEXT: e.value } };
      case 'boolean':
        return { type: 'zino_boolean', id, fields: { BOOL: e.value ? 'TRUE' : 'FALSE' } };
      case 'identifier':
        if (e.name === 'self') return { type: 'zino_self', id };
        if (e.name === 'other') return { type: 'zino_other', id };
        if (e.name === 'dt') return { type: 'zino_dt', id };
        return { type: 'zino_var_get', id, fields: { NAME: e.name } };
      case 'unary':
        return { type: e.op === '!' ? 'zino_not' : 'zino_negate', id, inputs: { VALUE: this.slot(e.operand) } };
      case 'binary': {
        const type =
          e.op === '&&' || e.op === '||'
            ? 'zino_logic'
            : ['==', '!=', '<', '<=', '>', '>='].includes(e.op)
              ? 'zino_compare'
              : 'zino_arith';
        return { type, id, fields: { OP: e.op }, inputs: { A: this.slot(e.left), B: this.slot(e.right) } };
      }
      case 'call':
        switch (e.callee) {
          case 'find':
            return { type: 'zino_find', id, inputs: { NAME: this.slot(e.args[0] ?? { kind: 'string', value: '' }) } };
          case 'getX':
          case 'getY':
          case 'getZ':
            return {
              type: 'zino_get_axis',
              id,
              fields: { AXIS: e.callee.slice(3) },
              inputs: { OBJ: this.slot(e.args[0] ?? { kind: 'identifier', name: 'self' }) },
            };
          case 'random':
            return {
              type: 'zino_random',
              id,
              inputs: {
                MIN: this.slot(e.args[0] ?? { kind: 'number', value: 0 }),
                MAX: this.slot(e.args[1] ?? { kind: 'number', value: 1 }),
              },
            };
          case 'getScore':
            return { type: 'zino_get_score', id };
          case 'isPressed': {
            const arg = e.args[0];
            return { type: 'zino_is_pressed', id, fields: { BUTTON: arg?.kind === 'string' ? arg.value : 'jump' } };
          }
        }
        throw new Error(`No block for ${e.callee}`);
      case 'null':
        throw new Error('No block for null');
    }
  }

  stmt(s: Stmt): BlockState {
    const id = this.newId(s.id);
    switch (s.kind) {
      case 'comment':
        return { type: 'zino_comment', id, fields: { TEXT: s.text } };
      case 'let':
        return { type: 'zino_var_create', id, fields: { NAME: s.name }, inputs: { VALUE: this.slot(s.init) } };
      case 'assign':
        if (s.op === '=') return { type: 'zino_var_set', id, fields: { NAME: s.name }, inputs: { VALUE: this.slot(s.value) } };
        return { type: 'zino_var_change', id, fields: { OP: s.op, NAME: s.name }, inputs: { VALUE: this.slot(s.value) } };
      case 'if': {
        const inputs: BlockState['inputs'] = { COND: this.slot(s.test) };
        const then = this.chain(s.then);
        if (then) inputs.DO = { block: then };
        if (s.else) {
          const otherwise = this.chain(s.else);
          if (otherwise) inputs.ELSE = { block: otherwise };
          return { type: 'zino_if_else', id, inputs };
        }
        return { type: 'zino_if', id, inputs };
      }
      case 'repeat': {
        const inputs: BlockState['inputs'] = { TIMES: this.slot(s.count) };
        const body = this.chain(s.body);
        if (body) inputs.DO = { block: body };
        return { type: 'zino_repeat', id, inputs };
      }
      case 'while': {
        const inputs: BlockState['inputs'] = { COND: this.slot(s.test) };
        const body = this.chain(s.body);
        if (body) inputs.DO = { block: body };
        return { type: 'zino_while', id, inputs };
      }
      case 'expr': {
        const call = s.expr;
        if (call.kind !== 'call') throw new Error('Unsupported statement');
        const type = STATEMENT_CALL_BLOCKS[call.callee];
        if (!type) throw new Error(`No block for ${call.callee}`);
        if (call.callee in VECTOR_CALLEES) {
          const [obj, x, y, z] = call.args;
          return {
            type,
            id,
            inputs: {
              OBJ: this.slot(obj ?? { kind: 'identifier', name: 'self' }),
              X: this.slot(x ?? { kind: 'number', value: 0 }),
              Y: this.slot(y ?? { kind: 'number', value: 0 }),
              Z: this.slot(z ?? { kind: 'number', value: 0 }),
            },
          };
        }
        const inputName = Object.values(SINGLE_ARG_STATEMENTS).find((v) => v.callee === call.callee)?.input ?? 'VALUE';
        return { type, id, inputs: { [inputName]: this.slot(call.args[0] ?? { kind: 'string', value: '' }) } };
      }
      default:
        throw new Error(`No block for ${s.kind}`);
    }
  }

  chain(list: Stmt[]): BlockState | undefined {
    let first: BlockState | undefined;
    let prev: BlockState | undefined;
    for (const s of splitMultilineComments(list)) {
      const b = this.stmt(s);
      if (!first) first = b;
      if (prev) prev.next = { block: b };
      prev = b;
    }
    return first;
  }
}

/** Note blocks hold one line of text, so multi-line comments become several notes. */
function splitMultilineComments<T extends Stmt | TopLevel>(list: T[]): T[] {
  const out: T[] = [];
  for (const s of list) {
    if (s.kind === 'comment' && s.text.includes('\n')) {
      s.text.split('\n').forEach((line, i) => out.push({ ...s, id: i === 0 ? s.id : undefined, text: line, block: false } as T));
    } else {
      out.push(s);
    }
  }
  return out;
}

const VECTOR_CALLEES: Record<string, true> = { move: true, rotate: true, setPosition: true, setRotation: true, applyForce: true };

function countStatements(list: Stmt[]): number {
  let n = 0;
  for (const s of list) {
    n += 1;
    if (s.kind === 'if') n += 1 + countStatements(s.then) + (s.else ? 1 + countStatements(s.else) : 0);
    if (s.kind === 'repeat' || s.kind === 'while') n += 1 + countStatements(s.body);
  }
  return n;
}

export interface ProgramToBlocksResult {
  state: WorkspaceState | null;
  issues: ConversionIssue[];
}

/** Converts IR to a Blockly workspace state, or reports why it cannot. */
export function programToBlocks(program: Program): ProgramToBlocksResult {
  const issues = findUnsupportedForBlocks(program);
  if (issues.length > 0) return { state: null, issues };
  const writer = new BlocksWriter();
  const blocks: BlockState[] = [];
  let y = 24;
  let pendingTopLevel: BlockState[] = [];

  const flushTopLevel = () => {
    if (pendingTopLevel.length === 0) return;
    const [first, ...rest] = pendingTopLevel;
    let prev = first as BlockState;
    for (const b of rest) {
      prev.next = { block: b };
      prev = b;
    }
    (first as BlockState).x = 24;
    (first as BlockState).y = y;
    blocks.push(first as BlockState);
    y += pendingTopLevel.length * 56 + 32;
    pendingTopLevel = [];
  };

  for (const node of splitMultilineComments(program.body)) {
    if (node.kind === 'var') {
      pendingTopLevel.push(writer.stmt({ kind: 'let', id: node.id, name: node.name, init: node.init }));
      continue;
    }
    if (node.kind === 'comment') {
      pendingTopLevel.push(writer.stmt(node));
      continue;
    }
    if (node.kind === 'event') {
      flushTopLevel();
      const type = Object.entries(EVENT_BLOCK_TYPES).find(([, ev]) => ev === node.event)?.[0] as string;
      const built: BlockState = { type, id: writer.newId(node.id), x: 24, y };
      if (node.event === 'button') built.fields = { BUTTON: node.button ?? 'jump' };
      const body = writer.chain(node.body);
      if (body) built.inputs = { DO: { block: body } };
      blocks.push(built);
      y += (countStatements(node.body) + 2) * 56 + 32;
    }
  }
  flushTopLevel();
  return { state: { blocks: { languageVersion: 0, blocks } }, issues: [] };
}

export function emptyWorkspaceState(): WorkspaceState {
  return { blocks: { languageVersion: 0, blocks: [] } };
}
