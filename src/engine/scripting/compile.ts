import { analyzeProgram } from './analyzer';
import { hasErrors, type Diagnostic, type Program } from './ast';
import { parse } from './parser';
import { printProgram } from './printer';

export interface CompileResult {
  /** Null when the script has errors and must not run. */
  program: Program | null;
  /** The parsed program even when it has errors (useful for tooling). */
  partial: Program;
  diagnostics: Diagnostic[];
}

/** Parses and statically checks Zino Script source text. */
export function compileSource(source: string): CompileResult {
  const { program, diagnostics } = parse(source);
  const all = [...diagnostics];
  if (!hasErrors(diagnostics)) all.push(...analyzeProgram(program));
  return { program: hasErrors(all) ? null : program, partial: program, diagnostics: all };
}

/**
 * Formats source text. Returns null (leaving the user's text untouched) if
 * the script does not parse, so formatting can never destroy code.
 */
export function formatSource(source: string): string | null {
  const { program, diagnostics } = parse(source);
  if (hasErrors(diagnostics)) return null;
  return printProgram(program).code;
}
