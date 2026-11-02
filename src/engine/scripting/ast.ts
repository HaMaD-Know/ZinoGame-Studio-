/**
 * Zino intermediate representation (IR), version 1.
 *
 * The IR is the single source of truth shared by:
 *   - the text parser (Zino Script → IR)
 *   - the code printer (IR → Zino Script, with source map)
 *   - the Blockly converter (blocks JSON ⇄ IR)
 *   - the analyzer (diagnostics) and the interpreter (execution)
 *
 * Nodes are plain JSON. `id` links a node to the Blockly block it came from
 * (or will become), `loc` links it to the text it was parsed from.
 * See docs/SCRIPTING.md for the language reference.
 */

export const ZINO_IR_VERSION = 1;

export interface SourceLoc {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  endLine: number;
  endColumn: number;
}

interface NodeBase {
  id?: string;
  loc?: SourceLoc;
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
export type UnaryOp = '-' | '!';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

export type Expr =
  | (NodeBase & { kind: 'number'; value: number })
  | (NodeBase & { kind: 'string'; value: string })
  | (NodeBase & { kind: 'boolean'; value: boolean })
  | (NodeBase & { kind: 'null' })
  | (NodeBase & { kind: 'identifier'; name: string })
  | (NodeBase & { kind: 'unary'; op: UnaryOp; operand: Expr })
  | (NodeBase & { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr })
  | (NodeBase & { kind: 'call'; callee: string; args: Expr[] });

export type CommentStmt = NodeBase & {
  kind: 'comment';
  text: string;
  /** Block comment (`/* *\/`) rather than a line comment. */
  block?: boolean;
  /** Was written at the end of the previous statement's line. */
  trailing?: boolean;
};

export type Stmt =
  | (NodeBase & { kind: 'let'; name: string; init: Expr })
  | (NodeBase & { kind: 'assign'; name: string; op: AssignOp; value: Expr })
  | (NodeBase & { kind: 'if'; test: Expr; then: Stmt[]; else: Stmt[] | null })
  | (NodeBase & { kind: 'repeat'; count: Expr; body: Stmt[] })
  | (NodeBase & { kind: 'while'; test: Expr; body: Stmt[] })
  | (NodeBase & { kind: 'expr'; expr: Expr })
  | (NodeBase & { kind: 'return'; value: Expr | null })
  | (NodeBase & { kind: 'break' })
  | (NodeBase & { kind: 'continue' })
  | CommentStmt;

export type EventName = 'start' | 'update' | 'collision' | 'button';
export const EVENT_NAMES: readonly EventName[] = ['start', 'update', 'collision', 'button'];

export type TopLevel =
  | (NodeBase & { kind: 'var'; name: string; init: Expr })
  | (NodeBase & { kind: 'event'; event: EventName; button: string | null; body: Stmt[] })
  | (NodeBase & { kind: 'function'; name: string; params: string[]; body: Stmt[] })
  | CommentStmt;

export interface Program {
  irVersion: typeof ZINO_IR_VERSION;
  body: TopLevel[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  loc?: SourceLoc;
  /** Block id (blocks mode) or IR node id. */
  nodeId?: string;
  hint?: string;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
