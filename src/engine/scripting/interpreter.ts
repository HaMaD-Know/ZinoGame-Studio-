import type { Vec3 } from '../core/math';
import type { EventName, Expr, Program, SourceLoc, Stmt, TopLevel } from './ast';
import { BUILTIN_MAP } from './api';

/**
 * Sandboxed Zino Script interpreter.
 *
 * Security model:
 *  - Scripts are executed by walking the IR; no eval / new Function / dynamic import.
 *  - Identifiers only resolve to script variables and the implicit variables
 *    (self, other, dt). There is no property access, so scripts cannot reach
 *    JavaScript objects, the DOM, storage or editor internals.
 *  - Every effect goes through the narrow ScriptHost interface.
 *  - Step, loop, recursion and string-size limits stop runaway scripts.
 */

export interface ObjectRef {
  readonly kind: 'object';
  readonly id: string;
}

export type ZValue = number | string | boolean | null | ObjectRef;

export interface ScriptHost {
  exists(id: string): boolean;
  findByName(name: string): string | null;
  nameOf(id: string): string;
  getPosition(id: string): Vec3;
  setPosition(id: string, value: Vec3): void;
  translate(id: string, delta: Vec3): void;
  getRotation(id: string): Vec3;
  setRotation(id: string, value: Vec3): void;
  rotate(id: string, delta: Vec3): void;
  setScale(id: string, value: Vec3): void;
  applyImpulse(id: string, impulse: Vec3): void;
  setVelocity(id: string, velocity: Vec3): void;
  destroy(id: string): void;
  setVisible(id: string, visible: boolean): void;
  setColor(id: string, color: string): void;
  showMessage(text: string): void;
  addScore(amount: number): void;
  setScore(value: number): void;
  getScore(): number;
  playSound(name: string): void;
  isPressed(button: string): boolean;
  time(): number;
  random(): number;
  log(message: string): void;
}

export interface ExecutionLimits {
  /** Max evaluation steps for a single event dispatch. */
  maxSteps: number;
  /** Max iterations of a single loop statement execution. */
  maxLoopIterations: number;
  /** Max nested function calls. */
  maxCallDepth: number;
  /** Max length of a text value. */
  maxStringLength: number;
}

export const DEFAULT_LIMITS: ExecutionLimits = {
  maxSteps: 100_000,
  maxLoopIterations: 10_000,
  maxCallDepth: 64,
  maxStringLength: 10_000,
};

export class ScriptRuntimeError extends Error {
  constructor(
    message: string,
    readonly loc?: SourceLoc,
    readonly nodeId?: string,
    readonly isLimit = false,
  ) {
    super(message);
    this.name = 'ScriptRuntimeError';
  }
}

type Signal = { type: 'break' } | { type: 'continue' } | { type: 'return'; value: ZValue } | undefined;

class Env {
  readonly vars = new Map<string, ZValue>();
  constructor(readonly parent: Env | null) {}

  lookup(name: string): Env | null {
    if (this.vars.has(name)) return this;
    for (let e = this.parent; e; e = e.parent) if (e.vars.has(name)) return e;
    return null;
  }
}

export function isObjectRef(v: ZValue): v is ObjectRef {
  return typeof v === 'object' && v !== null && v.kind === 'object';
}

export function displayValue(v: ZValue, host?: Pick<ScriptHost, 'nameOf'>): string {
  if (v === null) return 'nothing';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 10000) / 10000);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  return host ? host.nameOf(v.id) : `object(${v.id})`;
}

function typeName(v: ZValue): string {
  if (v === null) return 'nothing';
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'true/false';
  return 'an object';
}

function truthy(v: ZValue): boolean {
  return !(v === false || v === null || v === 0 || v === '' || (typeof v === 'number' && Number.isNaN(v)));
}

function valuesEqual(a: ZValue, b: ZValue): boolean {
  if (isObjectRef(a) && isObjectRef(b)) return a.id === b.id;
  return a === b;
}

export interface ScriptInstanceOptions {
  limits?: Partial<ExecutionLimits>;
  scriptName?: string;
  onError?: (error: ScriptRuntimeError) => void;
}

export class ScriptInstance {
  readonly limits: ExecutionLimits;
  readonly scriptName: string;
  private readonly globals = new Env(null);
  private readonly functions = new Map<string, Extract<TopLevel, { kind: 'function' }>>();
  private readonly handlers: Extract<TopLevel, { kind: 'event' }>[] = [];
  private steps = 0;
  private callDepth = 0;
  private started = false;
  private _disabled = false;
  private _lastError: ScriptRuntimeError | null = null;
  private readonly warned = new Set<string>();
  private readonly onError?: (error: ScriptRuntimeError) => void;

  constructor(
    private readonly program: Program,
    private readonly host: ScriptHost,
    readonly selfId: string,
    options: ScriptInstanceOptions = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.scriptName = options.scriptName ?? 'Script';
    this.onError = options.onError;
    for (const node of program.body) {
      if (node.kind === 'function') this.functions.set(node.name, node);
      else if (node.kind === 'event') this.handlers.push(node);
    }
  }

  get disabled(): boolean {
    return this._disabled;
  }

  get lastError(): ScriptRuntimeError | null {
    return this._lastError;
  }

  /** Stops the instance; later events are ignored. */
  stop(): void {
    this._disabled = true;
  }

  hasHandler(event: EventName): boolean {
    return this.handlers.some((h) => h.event === event);
  }

  start(): void {
    if (this.started || this._disabled) return;
    this.started = true;
    this.guard(() => {
      for (const node of this.program.body) {
        if (node.kind === 'var') {
          this.globals.vars.set(node.name, this.evalExpr(node.init, this.globals));
        }
      }
    });
    this.dispatch('start', {});
  }

  update(dt: number): void {
    this.dispatch('update', { dt });
  }

  collision(otherId: string): void {
    this.dispatch('collision', { other: { kind: 'object', id: otherId } });
  }

  button(name: string): void {
    this.dispatch('button', {}, name);
  }

  /** Reads a script-level variable (used by tests and the debugger). */
  getVariable(name: string): ZValue | undefined {
    return this.globals.vars.get(name);
  }

  private dispatch(event: EventName, implicit: Record<string, ZValue>, button?: string): void {
    if (this._disabled || !this.started) return;
    for (const handler of this.handlers) {
      if (this._disabled) return;
      if (handler.event !== event) continue;
      if (event === 'button' && handler.button !== button) continue;
      this.guard(() => {
        const env = new Env(this.globals);
        for (const [k, v] of Object.entries(implicit)) env.vars.set(k, v);
        this.execBlock(handler.body, env);
      });
    }
  }

  private guard(fn: () => void): void {
    this.steps = 0;
    this.callDepth = 0;
    try {
      fn();
    } catch (err) {
      const error =
        err instanceof ScriptRuntimeError
          ? err
          : new ScriptRuntimeError(`Internal script error: ${(err as Error)?.message ?? String(err)}`);
      this._lastError = error;
      this._disabled = true;
      this.onError?.(error);
    }
  }

  private tick(node: { loc?: SourceLoc; id?: string }): void {
    if (++this.steps > this.limits.maxSteps) {
      throw new ScriptRuntimeError(
        `This script did too much work in one go (more than ${this.limits.maxSteps.toLocaleString('en-US')} steps) and was stopped. Check for loops that never end.`,
        node.loc,
        node.id,
        true,
      );
    }
  }

  private execBlock(body: Stmt[], parent: Env): Signal {
    const env = new Env(parent);
    for (const stmt of body) {
      const signal = this.execStmt(stmt, env);
      if (signal) return signal;
    }
    return undefined;
  }

  private execStmt(s: Stmt, env: Env): Signal {
    if (s.kind === 'comment') return undefined;
    this.tick(s);
    switch (s.kind) {
      case 'let':
        env.vars.set(s.name, this.evalExpr(s.init, env));
        return undefined;
      case 'assign': {
        const target = env.lookup(s.name);
        if (!target || target === null) {
          throw new ScriptRuntimeError(`Unknown variable "${s.name}"`, s.loc, s.id);
        }
        const value = this.evalExpr(s.value, env);
        if (s.op === '=') {
          target.vars.set(s.name, value);
        } else {
          const current = target.vars.get(s.name) ?? null;
          const op = s.op[0] as '+' | '-' | '*' | '/';
          target.vars.set(s.name, this.binary(op, current, value, s));
        }
        return undefined;
      }
      case 'if':
        if (truthy(this.evalExpr(s.test, env))) return this.execBlock(s.then, env);
        if (s.else) return this.execBlock(s.else, env);
        return undefined;
      case 'repeat': {
        const count = this.evalExpr(s.count, env);
        if (typeof count !== 'number' || !Number.isFinite(count)) {
          throw new ScriptRuntimeError(`repeat needs a number but got ${typeName(count)}`, s.loc, s.id);
        }
        const times = Math.floor(count);
        if (times > this.limits.maxLoopIterations) {
          throw new ScriptRuntimeError(
            `repeat (${times}) is more than the limit of ${this.limits.maxLoopIterations.toLocaleString('en-US')} repeats`,
            s.loc,
            s.id,
            true,
          );
        }
        for (let i = 0; i < times; i++) {
          const signal = this.execBlock(s.body, env);
          if (signal?.type === 'break') break;
          if (signal?.type === 'return') return signal;
        }
        return undefined;
      }
      case 'while': {
        let iterations = 0;
        while (truthy(this.evalExpr(s.test, env))) {
          if (++iterations > this.limits.maxLoopIterations) {
            throw new ScriptRuntimeError(
              `This while loop ran more than ${this.limits.maxLoopIterations.toLocaleString('en-US')} times and was stopped. Make sure its condition becomes false.`,
              s.loc,
              s.id,
              true,
            );
          }
          const signal = this.execBlock(s.body, env);
          if (signal?.type === 'break') break;
          if (signal?.type === 'return') return signal;
        }
        return undefined;
      }
      case 'expr':
        this.evalExpr(s.expr, env);
        return undefined;
      case 'return':
        return { type: 'return', value: s.value ? this.evalExpr(s.value, env) : null };
      case 'break':
        return { type: 'break' };
      case 'continue':
        return { type: 'continue' };
    }
  }

  private evalExpr(e: Expr, env: Env): ZValue {
    this.tick(e);
    switch (e.kind) {
      case 'number':
        return e.value;
      case 'string':
        return e.value;
      case 'boolean':
        return e.value;
      case 'null':
        return null;
      case 'identifier': {
        if (e.name === 'self') return { kind: 'object', id: this.selfId };
        const scope = env.lookup(e.name);
        if (!scope) throw new ScriptRuntimeError(`Unknown variable "${e.name}"`, e.loc, e.id);
        return scope.vars.get(e.name) ?? null;
      }
      case 'unary': {
        const v = this.evalExpr(e.operand, env);
        if (e.op === '!') return !truthy(v);
        if (typeof v !== 'number') throw new ScriptRuntimeError(`Cannot make ${typeName(v)} negative`, e.loc, e.id);
        return -v;
      }
      case 'binary': {
        if (e.op === '&&') {
          return truthy(this.evalExpr(e.left, env)) ? truthy(this.evalExpr(e.right, env)) : false;
        }
        if (e.op === '||') {
          return truthy(this.evalExpr(e.left, env)) ? true : truthy(this.evalExpr(e.right, env));
        }
        const left = this.evalExpr(e.left, env);
        const right = this.evalExpr(e.right, env);
        return this.binary(e.op, left, right, e);
      }
      case 'call':
        return this.call(e, env);
    }
  }

  private binary(op: string, a: ZValue, b: ZValue, node: { loc?: SourceLoc; id?: string }): ZValue {
    switch (op) {
      case '==':
        return valuesEqual(a, b);
      case '!=':
        return !valuesEqual(a, b);
      case '+':
        if (typeof a === 'string' || typeof b === 'string') {
          const s = displayValue(a, this.host) + displayValue(b, this.host);
          if (s.length > this.limits.maxStringLength) {
            throw new ScriptRuntimeError('This text got too long', node.loc, node.id, true);
          }
          return s;
        }
        break;
      default:
        break;
    }
    if (typeof a !== 'number' || typeof b !== 'number') {
      const verb: Record<string, string> = {
        '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '%': 'take the remainder of',
        '<': 'compare', '<=': 'compare', '>': 'compare', '>=': 'compare',
      };
      if ((op === '<' || op === '>' || op === '<=' || op === '>=') && typeof a === 'string' && typeof b === 'string') {
        return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      }
      throw new ScriptRuntimeError(
        `Cannot ${verb[op] ?? 'combine'} ${typeName(a)} and ${typeName(b)}`,
        node.loc,
        node.id,
      );
    }
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        if (b === 0) throw new ScriptRuntimeError('Cannot divide by zero', node.loc, node.id);
        return a / b;
      case '%':
        if (b === 0) throw new ScriptRuntimeError('Cannot take the remainder of a division by zero', node.loc, node.id);
        return a % b;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
    }
    throw new ScriptRuntimeError(`Unknown operator ${op}`, node.loc, node.id);
  }

  private call(e: Extract<Expr, { kind: 'call' }>, env: Env): ZValue {
    const args = e.args.map((a) => this.evalExpr(a, env));
    const fn = this.functions.get(e.callee);
    if (fn) {
      if (++this.callDepth > this.limits.maxCallDepth) {
        throw new ScriptRuntimeError(
          `Too many nested function calls (limit ${this.limits.maxCallDepth}). Does "${e.callee}" call itself forever?`,
          e.loc,
          e.id,
          true,
        );
      }
      const fnEnv = new Env(this.globals);
      fn.params.forEach((p, i) => fnEnv.vars.set(p, args[i] ?? null));
      const signal = this.execBlock(fn.body, fnEnv);
      this.callDepth--;
      return signal?.type === 'return' ? signal.value : null;
    }
    return this.builtin(e, args);
  }

  private num(v: ZValue, fn: string, param: string, node: Expr): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ScriptRuntimeError(`${fn} needs a number for "${param}" but got ${typeName(v)}`, node.loc, node.id);
    }
    return v;
  }

  private str(v: ZValue, fn: string, param: string, node: Expr): string {
    if (typeof v !== 'string') {
      throw new ScriptRuntimeError(`${fn} needs text for "${param}" but got ${typeName(v)}`, node.loc, node.id);
    }
    return v;
  }

  /** Returns the object id, or null (with a one-time warning) for missing objects. */
  private objectId(v: ZValue, fn: string, node: Expr): string | null {
    if (!isObjectRef(v)) {
      throw new ScriptRuntimeError(
        `${fn} needs an object but got ${typeName(v)}`,
        node.loc,
        node.id,
      );
    }
    if (!this.host.exists(v.id)) {
      const key = `${fn}:${v.id}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.host.log(`[${this.scriptName}] ${fn}: the object no longer exists, so nothing happened.`);
      }
      return null;
    }
    return v.id;
  }

  private builtin(e: Extract<Expr, { kind: 'call' }>, args: ZValue[]): ZValue {
    const spec = BUILTIN_MAP.get(e.callee);
    if (!spec) throw new ScriptRuntimeError(`Unknown action "${e.callee}"`, e.loc, e.id);
    if (args.length !== spec.params.length) {
      throw new ScriptRuntimeError(`${e.callee} needs ${spec.params.length} values but got ${args.length}`, e.loc, e.id);
    }
    const h = this.host;
    const name = e.callee;
    const a0 = args[0] ?? null;
    const vec = (): Vec3 => [
      this.num(args[1] ?? null, name, 'x', e),
      this.num(args[2] ?? null, name, 'y', e),
      this.num(args[3] ?? null, name, 'z', e),
    ];
    const withObject = (fn: (id: string) => ZValue | void, fallback: ZValue = null): ZValue => {
      const id = this.objectId(a0, name, e);
      if (id === null) return fallback;
      const result = fn(id);
      return result === undefined ? null : result;
    };

    switch (name) {
      case 'move': {
        const v = vec();
        return withObject((id) => h.translate(id, v));
      }
      case 'rotate': {
        const v = vec();
        return withObject((id) => h.rotate(id, v));
      }
      case 'setPosition': {
        const v = vec();
        return withObject((id) => h.setPosition(id, v));
      }
      case 'setRotation': {
        const v = vec();
        return withObject((id) => h.setRotation(id, v));
      }
      case 'setScale': {
        const v = vec();
        return withObject((id) => h.setScale(id, v));
      }
      case 'applyForce': {
        const v = vec();
        return withObject((id) => h.applyImpulse(id, v));
      }
      case 'setVelocity': {
        const v = vec();
        return withObject((id) => h.setVelocity(id, v));
      }
      case 'getX':
        return withObject((id) => h.getPosition(id)[0], 0);
      case 'getY':
        return withObject((id) => h.getPosition(id)[1], 0);
      case 'getZ':
        return withObject((id) => h.getPosition(id)[2], 0);
      case 'distance': {
        const a = this.objectId(a0, name, e);
        const b = this.objectId(args[1] ?? null, name, e);
        if (!a || !b) return 0;
        const pa = h.getPosition(a);
        const pb = h.getPosition(b);
        return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      }
      case 'find': {
        const id = h.findByName(this.str(a0, name, 'name', e));
        return id ? { kind: 'object', id } : null;
      }
      case 'destroy':
        return withObject((id) => h.destroy(id));
      case 'setVisible':
        return withObject((id) => h.setVisible(id, truthy(args[1] ?? null)));
      case 'setColor': {
        const color = this.str(args[1] ?? null, name, 'color', e);
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
          throw new ScriptRuntimeError(`setColor needs a colour like "#ff8800" but got "${color}"`, e.loc, e.id);
        }
        return withObject((id) => h.setColor(id, color));
      }
      case 'exists':
        return isObjectRef(a0) ? h.exists(a0.id) : false;
      case 'nameOf':
        return withObject((id) => h.nameOf(id), '');
      case 'showMessage':
        h.showMessage(displayValue(a0, h).slice(0, 500));
        return null;
      case 'addScore':
        h.addScore(this.num(a0, name, 'amount', e));
        return null;
      case 'setScore':
        h.setScore(this.num(a0, name, 'value', e));
        return null;
      case 'getScore':
        return h.getScore();
      case 'time':
        return h.time();
      case 'playSound':
        h.playSound(this.str(a0, name, 'name', e));
        return null;
      case 'isPressed':
        return h.isPressed(this.str(a0, name, 'button', e));
      case 'random': {
        const lo = this.num(a0, name, 'min', e);
        const hi = this.num(args[1] ?? null, name, 'max', e);
        return lo + h.random() * (hi - lo);
      }
      case 'randomInt': {
        const lo = Math.ceil(this.num(a0, name, 'min', e));
        const hi = Math.floor(this.num(args[1] ?? null, name, 'max', e));
        return lo + Math.floor(h.random() * (hi - lo + 1));
      }
      case 'abs':
        return Math.abs(this.num(a0, name, 'value', e));
      case 'min':
        return Math.min(this.num(a0, name, 'a', e), this.num(args[1] ?? null, name, 'b', e));
      case 'max':
        return Math.max(this.num(a0, name, 'a', e), this.num(args[1] ?? null, name, 'b', e));
      case 'sqrt': {
        const v = this.num(a0, name, 'value', e);
        if (v < 0) throw new ScriptRuntimeError('Cannot take the square root of a negative number', e.loc, e.id);
        return Math.sqrt(v);
      }
      case 'round':
        return Math.round(this.num(a0, name, 'value', e));
      case 'floor':
        return Math.floor(this.num(a0, name, 'value', e));
      case 'sin':
        return Math.sin((this.num(a0, name, 'degrees', e) * Math.PI) / 180);
      case 'cos':
        return Math.cos((this.num(a0, name, 'degrees', e) * Math.PI) / 180);
      case 'log':
        h.log(`[${this.scriptName}] ${displayValue(a0, h)}`);
        return null;
    }
    throw new ScriptRuntimeError(`"${name}" is not available yet`, e.loc, e.id);
  }
}
