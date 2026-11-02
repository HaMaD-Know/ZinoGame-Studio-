import { createId } from '../core/ids';
import type { ScriptDoc, ScriptMode } from '../project/types';
import { analyzeProgram } from './analyzer';
import { hasErrors, type Diagnostic, type Program } from './ast';
import { blocksToProgram, emptyWorkspaceState, programToBlocks, type ConversionIssue, type WorkspaceState } from './blocks/convert';
import { compileSource } from './compile';
import { parse } from './parser';
import { printProgram, type SourceMapEntry } from './printer';

/**
 * High-level operations on script documents: compiling either mode,
 * and switching between blocks and text without losing user code.
 */

export interface CompiledScript {
  /** Runnable program, or null if there are errors. */
  program: Program | null;
  diagnostics: Diagnostic[];
  /** Text form (generated in blocks mode, the user's text in text mode). */
  code: string;
  /** Block id ↔ line links (blocks mode only). */
  sourceMap: SourceMapEntry[];
  looseBlockIds: string[];
}

export const DEFAULT_TEXT_SCRIPT = `// Runs once when the game starts
on start {
  showMessage("Hello from " + nameOf(self) + "!")
}

// Runs every frame: spin slowly
on update {
  rotate(self, 0, 45 * dt, 0)
}
`;

export function createScriptDoc(name: string, mode: ScriptMode, source?: string): ScriptDoc {
  const now = new Date().toISOString();
  const text = source ?? (mode === 'text' ? DEFAULT_TEXT_SCRIPT : '');
  let blocks: unknown = null;
  if (mode === 'blocks') {
    const parsed = parse(text);
    const converted = text.trim() && !hasErrors(parsed.diagnostics) ? programToBlocks(parsed.program) : null;
    blocks = converted?.state ?? emptyWorkspaceState();
  }
  const doc: ScriptDoc = {
    id: createId('scr'),
    name,
    mode,
    source: text,
    blocks,
    textBackup: null,
    createdAt: now,
    updatedAt: now,
  };
  if (mode === 'blocks') doc.source = compileScriptDoc(doc).code;
  return doc;
}

export function compileScriptDoc(doc: Pick<ScriptDoc, 'mode' | 'source' | 'blocks'>): CompiledScript {
  if (doc.mode === 'text') {
    const result = compileSource(doc.source);
    return { program: result.program, diagnostics: result.diagnostics, code: doc.source, sourceMap: [], looseBlockIds: [] };
  }
  const { program, diagnostics, looseBlockIds } = blocksToProgram(doc.blocks);
  const printed = printProgram(program);
  const all = [...diagnostics, ...analyzeProgram(program)];
  return {
    program: hasErrors(all) ? null : program,
    diagnostics: all,
    code: printed.code,
    sourceMap: printed.sourceMap,
    looseBlockIds,
  };
}

export type ToBlocksResult =
  | { ok: true; blocks: WorkspaceState; textBackup: string; generatedText: string }
  | { ok: false; reason: 'syntax'; diagnostics: Diagnostic[] }
  | { ok: false; reason: 'unsupported'; issues: ConversionIssue[] };

/**
 * Attempts text → blocks. Never modifies the document; the caller decides
 * whether to apply the result. The original text is returned as a backup.
 */
export function textToBlocks(source: string): ToBlocksResult {
  const parsed = parse(source);
  if (hasErrors(parsed.diagnostics)) return { ok: false, reason: 'syntax', diagnostics: parsed.diagnostics };
  const converted = programToBlocks(parsed.program);
  if (!converted.state) return { ok: false, reason: 'unsupported', issues: converted.issues };
  const generated = compileScriptDoc({ mode: 'blocks', source: '', blocks: converted.state }).code;
  return { ok: true, blocks: converted.state, textBackup: source, generatedText: generated };
}

export interface ToTextResult {
  text: string;
  /** Blocks that are outside events; they are not included in the text. */
  looseBlockIds: string[];
}

export function blocksToText(blocks: unknown): ToTextResult {
  const compiled = compileScriptDoc({ mode: 'blocks', source: '', blocks });
  return { text: compiled.code, looseBlockIds: compiled.looseBlockIds };
}
