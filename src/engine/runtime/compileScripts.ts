import type { ScriptDoc } from '../project/types';
import { compileScriptDoc } from '../scripting/scriptDoc';
import type { CompiledRuntimeScript } from './GameRuntime';

/** Compiles every script once before play starts. Scripts with errors are reported, not run. */
export function compileScriptsForRuntime(scripts: Record<string, ScriptDoc>): Record<string, CompiledRuntimeScript> {
  const out: Record<string, CompiledRuntimeScript> = {};
  for (const doc of Object.values(scripts)) {
    const compiled = compileScriptDoc(doc);
    if (compiled.program) {
      out[doc.id] = { id: doc.id, name: doc.name, program: compiled.program };
    } else {
      const first = compiled.diagnostics.find((d) => d.severity === 'error');
      const where = first?.loc ? ` (line ${first.loc.line})` : '';
      out[doc.id] = {
        id: doc.id,
        name: doc.name,
        program: null,
        error: `This script has errors and was not started${where}: ${first?.message ?? 'unknown error'}`,
      };
    }
  }
  return out;
}
