import type { Diagnostic, EventName, Expr, Program, SourceLoc, Stmt } from './ast';
import { BUILTIN_MAP, IMPLICIT_VARIABLES, isValidButtonName, RESERVED_NAMES } from './api';

/**
 * Static checks run before a script is allowed to execute. They catch the
 * mistakes beginners make most often and explain them in plain language.
 */

interface Scope {
  names: Set<string>;
  parent: Scope | null;
}

interface Context {
  event: EventName | null;
  inFunction: boolean;
  loopDepth: number;
}

function has(scope: Scope | null, name: string): boolean {
  for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
  return false;
}

export function analyzeProgram(program: Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const functions = new Map<string, number>();
  const globals: Scope = { names: new Set(), parent: null };

  const report = (severity: Diagnostic['severity'], message: string, node: { id?: string; loc?: SourceLoc }, hint?: string) => {
    diagnostics.push({ severity, message, loc: node.loc, nodeId: node.id, hint });
  };

  // Pass 1: collect functions and script-level variables (hoisted).
  for (const node of program.body) {
    if (node.kind === 'function') {
      if (RESERVED_NAMES.has(node.name)) {
        report('error', `"${node.name}" is a built-in name and cannot be used for a function`, node);
      } else if (functions.has(node.name)) {
        report('error', `Function "${node.name}" is declared twice`, node);
      }
      functions.set(node.name, node.params.length);
    } else if (node.kind === 'var') {
      if (RESERVED_NAMES.has(node.name)) {
        report('error', `"${node.name}" is a built-in name. Please choose another variable name.`, node);
      } else if (globals.names.has(node.name)) {
        report('error', `Variable "${node.name}" is created twice`, node);
      }
      globals.names.add(node.name);
    }
  }

  const checkExpr = (e: Expr, scope: Scope, ctx: Context): void => {
    switch (e.kind) {
      case 'identifier': {
        const implicit = IMPLICIT_VARIABLES.find((v) => v.name === e.name);
        if (implicit) {
          if (implicit.events && !(ctx.event && implicit.events.includes(ctx.event))) {
            report(
              'error',
              `"${e.name}" can only be used inside ${implicit.events.map((ev) => `"on ${ev}"`).join(' or ')}`,
              e,
              implicit.doc,
            );
          }
          return;
        }
        if (!has(scope, e.name)) {
          const hint = BUILTIN_MAP.has(e.name) ? `Did you mean ${e.name}(...)?` : `Create it first, e.g. var ${e.name} = 0`;
          report('error', `Unknown variable "${e.name}"`, e, hint);
        }
        return;
      }
      case 'unary':
        checkExpr(e.operand, scope, ctx);
        return;
      case 'binary':
        checkExpr(e.left, scope, ctx);
        checkExpr(e.right, scope, ctx);
        return;
      case 'call': {
        const builtin = BUILTIN_MAP.get(e.callee);
        const fnArity = functions.get(e.callee);
        if (!builtin && fnArity === undefined) {
          report('error', `Unknown action "${e.callee}"`, e, 'Check the spelling, or open the Script API reference.');
        } else {
          const expected = builtin ? builtin.params.length : (fnArity as number);
          if (e.args.length !== expected) {
            const usage = builtin ? builtin.example : `${e.callee}(...)`;
            report(
              'error',
              `${e.callee} needs ${expected} value${expected === 1 ? '' : 's'} but got ${e.args.length}`,
              e,
              `Example: ${usage}`,
            );
          }
          if (builtin?.name === 'isPressed') {
            const arg = e.args[0];
            if (arg?.kind === 'string' && !isValidButtonName(arg.value)) {
              report('warning', `"${arg.value}" is not a known button`, arg, 'Try "jump", "action", "left", "right", "forward" or "back".');
            }
          }
        }
        for (const a of e.args) checkExpr(a, scope, ctx);
        return;
      }
      default:
        return;
    }
  };

  const checkBlock = (body: Stmt[], parent: Scope, ctx: Context): void => {
    const scope: Scope = { names: new Set(), parent };
    for (const s of body) checkStmt(s, scope, ctx);
  };

  const checkStmt = (s: Stmt, scope: Scope, ctx: Context): void => {
    switch (s.kind) {
      case 'let':
        checkExpr(s.init, scope, ctx);
        if (RESERVED_NAMES.has(s.name)) {
          report('error', `"${s.name}" is a built-in name. Please choose another variable name.`, s);
        } else if (scope.names.has(s.name)) {
          report('error', `Variable "${s.name}" already exists here`, s);
        }
        scope.names.add(s.name);
        return;
      case 'assign':
        checkExpr(s.value, scope, ctx);
        if (RESERVED_NAMES.has(s.name)) report('error', `"${s.name}" cannot be changed`, s);
        else if (!has(scope, s.name)) {
          report('error', `Unknown variable "${s.name}"`, s, `Create it first, e.g. var ${s.name} = 0`);
        }
        return;
      case 'if':
        checkExpr(s.test, scope, ctx);
        checkBlock(s.then, scope, ctx);
        if (s.else) checkBlock(s.else, scope, ctx);
        return;
      case 'repeat':
        checkExpr(s.count, scope, ctx);
        checkBlock(s.body, scope, { ...ctx, loopDepth: ctx.loopDepth + 1 });
        return;
      case 'while':
        checkExpr(s.test, scope, ctx);
        if (s.test.kind === 'boolean' && s.test.value && !containsExit(s.body)) {
          report('warning', 'This loop never ends on its own. It will be stopped by the safety limit.', s);
        }
        checkBlock(s.body, scope, { ...ctx, loopDepth: ctx.loopDepth + 1 });
        return;
      case 'expr':
        checkExpr(s.expr, scope, ctx);
        return;
      case 'return':
        if (s.value) checkExpr(s.value, scope, ctx);
        return;
      case 'break':
      case 'continue':
        if (ctx.loopDepth === 0) report('error', `"${s.kind}" can only be used inside a loop`, s);
        return;
      case 'comment':
        return;
    }
  };

  // Pass 2: check bodies.
  for (const node of program.body) {
    switch (node.kind) {
      case 'var':
        checkExpr(node.init, globals, { event: null, inFunction: false, loopDepth: 0 });
        break;
      case 'event':
        if (node.event === 'button' && node.button !== null && !isValidButtonName(node.button)) {
          report('warning', `"${node.button}" is not a known button`, node, 'Try "jump", "action", "left", "right", "forward" or "back".');
        }
        checkBlock(node.body, globals, { event: node.event, inFunction: false, loopDepth: 0 });
        break;
      case 'function': {
        const scope: Scope = { names: new Set(node.params), parent: globals };
        for (const p of node.params) {
          if (RESERVED_NAMES.has(p)) report('error', `"${p}" is a built-in name and cannot be a parameter`, node);
        }
        checkBlock(node.body, scope, { event: null, inFunction: true, loopDepth: 0 });
        break;
      }
      case 'comment':
        break;
    }
  }
  return diagnostics;
}

function containsExit(body: Stmt[]): boolean {
  return body.some((s) => {
    if (s.kind === 'break' || s.kind === 'return') return true;
    if (s.kind === 'if') return containsExit(s.then) || (s.else ? containsExit(s.else) : false);
    return false;
  });
}
