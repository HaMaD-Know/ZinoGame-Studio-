import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/math';
import { hasErrors } from './ast';
import { blocksToProgram, findUnsupportedForBlocks, programToBlocks, type BlockState } from './blocks/convert';
import { BLOCK_DEFINITIONS, buildToolbox } from './blocks/definitions';
import { compileSource, formatSource } from './compile';
import { ScriptInstance, type ScriptHost, type ScriptRuntimeError } from './interpreter';
import { parse } from './parser';
import { nodeAtLine, printProgram } from './printer';
import { blocksToText, compileScriptDoc, createScriptDoc, textToBlocks } from './scriptDoc';

function makeHost(overrides: Partial<ScriptHost> = {}) {
  const positions = new Map<string, Vec3>([
    ['self', [0, 0, 0]],
    ['coin', [5, 0, 0]],
  ]);
  const log: string[] = [];
  const messages: string[] = [];
  const destroyed: string[] = [];
  let score = 0;
  const host: ScriptHost = {
    exists: (id) => positions.has(id),
    findByName: (name) => (name === 'Coin' ? 'coin' : null),
    nameOf: (id) => (id === 'coin' ? 'Coin' : 'Self'),
    getPosition: (id) => positions.get(id) ?? [0, 0, 0],
    setPosition: (id, v) => void positions.set(id, v),
    translate: (id, d) => {
      const p = positions.get(id) ?? [0, 0, 0];
      positions.set(id, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
    },
    getRotation: () => [0, 0, 0],
    setRotation: () => {},
    rotate: () => {},
    setScale: () => {},
    applyImpulse: () => {},
    setVelocity: () => {},
    destroy: (id) => {
      destroyed.push(id);
      positions.delete(id);
    },
    setVisible: () => {},
    setColor: () => {},
    showMessage: (t) => void messages.push(t),
    addScore: (n) => void (score += n),
    setScore: (n) => void (score = n),
    getScore: () => score,
    playSound: () => {},
    isPressed: () => false,
    time: () => 0,
    random: () => 0.5,
    log: (m) => void log.push(m),
    ...overrides,
  };
  return { host, positions, log, messages, destroyed, getScore: () => score };
}

const SAMPLE = `// Score keeper
var speed = 2

on start {
  showMessage("Go!") // greet
  let total = 1 + 2 * 3
  if (total > 5) {
    addScore(total)
  } else {
    addScore(-1)
  }
}

on update {
  move(self, speed * dt, 0, 0)
}

on collision {
  destroy(other)
}

on button("jump") {
  repeat (3) {
    applyForce(self, 0, 1, 0)
  }
}
`;

describe('Zino Script parser and printer', () => {
  it('parses a full script without errors', () => {
    const { program, diagnostics } = parse(SAMPLE);
    expect(diagnostics).toEqual([]);
    expect(program.body.filter((n) => n.kind === 'event')).toHaveLength(4);
    expect(program.body.find((n) => n.kind === 'var')).toMatchObject({ name: 'speed' });
  });

  it('keeps comments as IR nodes so formatting never drops them', () => {
    const formatted = formatSource(SAMPLE);
    expect(formatted).toContain('// Score keeper');
    expect(formatted).toContain('showMessage("Go!") // greet');
  });

  it('formats idempotently', () => {
    const once = formatSource(SAMPLE) as string;
    expect(formatSource(once)).toBe(once);
  });

  it('respects operator precedence and parentheses when printing', () => {
    const src = 'on start {\n  let a = (1 + 2) * 3\n  let b = 1 - (2 - 3)\n  let c = -(4)\n}\n';
    const out = formatSource(src) as string;
    expect(out).toContain('let a = (1 + 2) * 3');
    expect(out).toContain('let b = 1 - (2 - 3)');
    expect(out).toContain('let c = -4');
  });

  it('reports syntax errors with line numbers and recovers to find more', () => {
    const { diagnostics } = parse('on start {\n  move(self, 1, 2\n  let = 5\n}\n');
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(diagnostics[0]?.loc?.line).toBe(3);
  });

  it('rejects code outside events with a helpful hint', () => {
    const { diagnostics } = parse('move(self, 1, 0, 0)');
    expect(diagnostics[0]?.message).toMatch(/inside an event/);
  });

  it('does not loop forever on garbage input', () => {
    const { diagnostics } = parse('} } ) on on { ( ; = = 3 "');
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('formatSource leaves broken code untouched', () => {
    expect(formatSource('on start { move(')).toBeNull();
  });

  it('builds a source map from node ids to lines', () => {
    const { program } = parse('on start {\n  addScore(1)\n}\n');
    const event = program.body[0];
    if (event?.kind !== 'event') throw new Error('expected event');
    event.id = 'evt1';
    const first = event.body[0];
    if (first) first.id = 'stmt1';
    const { sourceMap } = printProgram(program);
    expect(nodeAtLine(sourceMap, 2)).toBe('stmt1');
    expect(nodeAtLine(sourceMap, 1)).toBe('evt1');
  });
});

describe('Zino Script analyzer', () => {
  it('flags unknown variables, functions and wrong argument counts', () => {
    const { diagnostics, program } = compileSource('on start {\n  x = 1\n  jump()\n  move(self, 1)\n}\n');
    expect(program).toBeNull();
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toMatch(/Unknown variable "x"/);
    expect(messages).toMatch(/Unknown action "jump"/);
    expect(messages).toMatch(/move needs 4 values/);
  });

  it('only allows dt in update and other in collision', () => {
    const { diagnostics } = compileSource('on start {\n  move(self, dt, 0, 0)\n  destroy(other)\n}\n');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(2);
  });

  it('forbids break outside loops', () => {
    expect(hasErrors(compileSource('on start {\n  break\n}\n').diagnostics)).toBe(true);
  });
});

describe('Zino Script interpreter', () => {
  it('runs start, update, collision and button events', () => {
    const env = makeHost();
    const { program } = compileSource(SAMPLE);
    expect(program).not.toBeNull();
    const inst = new ScriptInstance(program!, env.host, 'self');
    inst.start();
    expect(env.messages).toEqual(['Go!']);
    expect(env.getScore()).toBe(7);
    inst.update(0.5);
    expect(env.positions.get('self')?.[0]).toBeCloseTo(1);
    inst.collision('coin');
    expect(env.destroyed).toEqual(['coin']);
    inst.button('jump');
    expect(inst.disabled).toBe(false);
  });

  it('stops infinite while loops with a clear error', () => {
    const env = makeHost();
    const errors: ScriptRuntimeError[] = [];
    const { program } = compileSource('on start {\n  while (true) {\n    addScore(1)\n  }\n}\n');
    const inst = new ScriptInstance(program!, env.host, 'self', { onError: (e) => errors.push(e) });
    inst.start();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.isLimit).toBe(true);
    expect(errors[0]?.loc?.line).toBe(2);
    expect(inst.disabled).toBe(true);
    // Further events are ignored once disabled.
    inst.update(0.016);
    expect(errors).toHaveLength(1);
  });

  it('enforces the step budget on deep recursion', () => {
    const env = makeHost();
    const errors: ScriptRuntimeError[] = [];
    const { program } = compileSource('function f(n) {\n  return f(n + 1)\n}\non start {\n  f(0)\n}\n');
    const inst = new ScriptInstance(program!, env.host, 'self', { onError: (e) => errors.push(e) });
    inst.start();
    expect(errors[0]?.message).toMatch(/nested function calls/);
  });

  it('reports type errors and division by zero at the right line', () => {
    const env = makeHost();
    const errors: ScriptRuntimeError[] = [];
    const { program } = compileSource('on start {\n  let a = 1\n  let b = a / 0\n}\n');
    new ScriptInstance(program!, env.host, 'self', { onError: (e) => errors.push(e) }).start();
    expect(errors[0]?.message).toMatch(/divide by zero/);
    expect(errors[0]?.loc?.line).toBe(3);
  });

  it('supports functions, while loops, break and string concatenation', () => {
    const env = makeHost();
    const src = `var count = 0
function double(n) {
  return n * 2
}
on start {
  while (count < 100) {
    count += 1
    if (count == 5) {
      break
    }
  }
  showMessage("count=" + double(count))
}
`;
    const { program, diagnostics } = compileSource(src);
    expect(diagnostics).toEqual([]);
    const inst = new ScriptInstance(program!, env.host, 'self');
    inst.start();
    expect(env.messages).toEqual(['count=10']);
    expect(inst.getVariable('count')).toBe(5);
  });

  it('cannot reach JavaScript globals', () => {
    const { program } = compileSource('on start {\n  log(window)\n}\n');
    expect(program).toBeNull();
    const parsed = parse('on start {\n  log(globalThis.process)\n}\n');
    expect(hasErrors(parsed.diagnostics)).toBe(true);
  });

  it('treats actions on destroyed objects as no-ops with a warning', () => {
    const env = makeHost();
    const { program } = compileSource('on start {\n  let c = find("Coin")\n  destroy(c)\n  move(c, 1, 0, 0)\n}\n');
    const inst = new ScriptInstance(program!, env.host, 'self');
    inst.start();
    expect(inst.disabled).toBe(false);
    expect(env.log.join()).toMatch(/no longer exists/);
  });
});

describe('Blocks ⇄ IR conversion', () => {
  it('defines every block type referenced by the toolbox', () => {
    const defined = new Set(BLOCK_DEFINITIONS.map((d) => d.type));
    const toolbox = JSON.stringify(buildToolbox());
    for (const m of toolbox.matchAll(/"type":"(zino_[a-z_]+)"/g)) expect(defined.has(m[1] as string)).toBe(true);
  });

  it('round-trips text → blocks → text without changing the code', () => {
    const formatted = formatSource(SAMPLE) as string;
    const result = textToBlocks(formatted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const back = blocksToText(result.blocks).text;
    // Trailing comments move to their own line as note blocks, but nothing is lost.
    expect(back).toMatch(/\n {2}\/\/ greet\n/);
    expect(formatSource(back)).toBe(back);
    const normalise = (s: string) => s.replace(/\s*\/\/ greet/, '').replace(/\n\s*\n/g, '\n');
    expect(normalise(back)).toBe(normalise(formatted));
  });

  it('keeps unsupported text in text mode and explains why', () => {
    const src = 'function helper() {\n  return 1\n}\non start {\n  setScale(self, 2, 2, 2)\n}\n';
    const result = textToBlocks(src);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'unsupported') throw new Error('expected unsupported');
    const messages = result.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/Custom function "helper"/);
    expect(messages).toMatch(/setScale/);
  });

  it('refuses to convert text with syntax errors', () => {
    const result = textToBlocks('on start {');
    expect(result).toMatchObject({ ok: false, reason: 'syntax' });
  });

  it('serialises blocks to IR with block ids for source mapping', () => {
    const blocks: BlockState[] = [
      {
        type: 'zino_on_update',
        id: 'evt',
        x: 0,
        y: 0,
        inputs: {
          DO: {
            block: {
              type: 'zino_rotate',
              id: 'rot',
              inputs: {
                OBJ: { shadow: { type: 'zino_self', id: 's1' } },
                X: { shadow: { type: 'zino_number', id: 'n1', fields: { NUM: 0 } } },
                Y: {
                  block: {
                    type: 'zino_arith',
                    id: 'mul',
                    fields: { OP: '*' },
                    inputs: {
                      A: { shadow: { type: 'zino_number', id: 'n2', fields: { NUM: 90 } } },
                      B: { block: { type: 'zino_dt', id: 'dt' } },
                    },
                  },
                },
                Z: { shadow: { type: 'zino_number', id: 'n3', fields: { NUM: 0 } } },
              },
            },
          },
        },
      },
    ];
    const compiled = compileScriptDoc({ mode: 'blocks', source: '', blocks: { blocks: { languageVersion: 0, blocks } } });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.code).toBe('on update {\n  rotate(self, 0, 90 * dt, 0)\n}\n');
    expect(nodeAtLine(compiled.sourceMap, 2)).toBe('rot');
    expect(compiled.program).not.toBeNull();
  });

  it('warns about loose blocks outside events and empty slots', () => {
    const state = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'zino_add_score', id: 'loose', x: 0, y: 100 },
          { type: 'zino_on_start', id: 'start', x: 0, y: 0, inputs: { DO: { block: { type: 'zino_add_score', id: 'add' } } } },
        ],
      },
    };
    const result = blocksToProgram(state);
    expect(result.looseBlockIds).toEqual(['loose']);
    expect(result.diagnostics.some((d) => d.nodeId === 'add' && d.severity === 'warning')).toBe(true);
    expect(blocksToText(state).text).toBe('on start {\n  addScore(1)\n}\n');
  });

  it('lists nothing unsupported for block-compatible programs', () => {
    const { program } = parse(SAMPLE);
    expect(findUnsupportedForBlocks(program)).toEqual([]);
    expect(programToBlocks(program).state).not.toBeNull();
  });

  it('creates default script documents in both modes', () => {
    const text = createScriptDoc('Spinner', 'text');
    expect(compileScriptDoc(text).program).not.toBeNull();
    const blocks = createScriptDoc('Blocks', 'blocks', 'on start {\n  addScore(1)\n}\n');
    expect(blocks.source).toBe('on start {\n  addScore(1)\n}\n');
    expect(compileScriptDoc(blocks).program).not.toBeNull();
  });
});

describe('Block definitions compatibility', () => {
  // Fields that ship with Blockly core. Plugin-only fields (e.g. multi-line text) would
  // silently drop user data on load, so they must never be used.
  const CORE_FIELDS = new Set(['field_input', 'field_number', 'field_dropdown', 'field_checkbox', 'field_label', 'field_label_serializable', 'field_image', 'field_variable']);

  it('only uses Blockly core field types', () => {
    for (const def of BLOCK_DEFINITIONS) {
      for (const key of Object.keys(def).filter((k) => k.startsWith('args'))) {
        for (const arg of def[key] as { type: string }[]) {
          if (arg.type.startsWith('field_')) expect(CORE_FIELDS.has(arg.type), `${String(def.type)} uses ${arg.type}`).toBe(true);
        }
      }
    }
  });

  it('keeps multi-line comments as several note blocks without losing text', () => {
    const src = '/*\n first line\n second line\n*/\non start {\n  addScore(1)\n}\n';
    const result = textToBlocks(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = blocksToText(result.blocks).text;
    expect(text).toContain('first line');
    expect(text).toContain('second line');
    expect(text).toContain('addScore(1)');
  });
});
