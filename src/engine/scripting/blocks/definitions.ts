import { NAMED_BUTTONS } from '../api';

/**
 * Blockly block definitions for Zino Script, as plain JSON (no Blockly
 * import) so they can be shared by the editor UI and by tests.
 * Every block maps 1:1 to an IR construct; see convert.ts.
 */

export const BLOCK_COLOURS = {
  events: '#f2a93b',
  motion: '#4c97ff',
  physics: '#ff6680',
  objects: '#2bb3a3',
  game: '#9966ff',
  input: '#5cb1d6',
  logic: '#59c059',
  loops: '#3fae6a',
  math: '#4d6bf0',
  text: '#c47f2c',
  variables: '#ff8c1a',
  comment: '#8a94a6',
} as const;

const BUTTON_OPTIONS: [string, string][] = NAMED_BUTTONS.map((b) => [b.label.toLowerCase(), b.name]);

export const ASSIGN_OP_OPTIONS: [string, string][] = [
  ['increase', '+='],
  ['decrease', '-='],
  ['multiply', '*='],
  ['divide', '/='],
];

export const ARITH_OP_OPTIONS: [string, string][] = [
  ['+', '+'],
  ['−', '-'],
  ['×', '*'],
  ['÷', '/'],
  ['remainder', '%'],
];

export const COMPARE_OP_OPTIONS: [string, string][] = [
  ['=', '=='],
  ['≠', '!='],
  ['<', '<'],
  ['≤', '<='],
  ['>', '>'],
  ['≥', '>='],
];

export const LOGIC_OP_OPTIONS: [string, string][] = [
  ['and', '&&'],
  ['or', '||'],
];

type Json = Record<string, unknown>;

const XYZ_ARGS: Json[] = ['X', 'Y', 'Z'].map((name) => ({ type: 'input_value', name, check: 'Number' }));

/** Theme block style for event (hat) blocks; registered by the block editor theme. */
export const EVENT_BLOCK_STYLE = 'zino_event_blocks';

function vectorAction(type: string, message: string, colour: string, tooltip: string): Json {
  return {
    type,
    message0: message,
    args0: [{ type: 'input_value', name: 'OBJ', check: 'Object' }, ...XYZ_ARGS],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour,
    tooltip,
  };
}

function eventBlock(type: string, message: string, tooltip: string, extraArgs: Json[] = []): Json {
  return {
    type,
    message0: message,
    args0: [...extraArgs],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    style: EVENT_BLOCK_STYLE,
    tooltip,
  };
}

export const BLOCK_DEFINITIONS: Json[] = [
  // ── Events ────────────────────────────────────────────────
  eventBlock('zino_on_start', 'when the game starts', 'Runs once when the game starts.'),
  eventBlock('zino_on_update', 'every frame', 'Runs every frame. Use "frame time" for smooth movement.'),
  eventBlock('zino_on_collision', 'when this object touches something', 'Runs when this object touches another object.'),
  eventBlock('zino_on_button', 'when %1 button is pressed', 'Runs when a button is pressed.', [
    { type: 'field_dropdown', name: 'BUTTON', options: BUTTON_OPTIONS },
  ]),

  // ── Motion ────────────────────────────────────────────────
  vectorAction('zino_move', 'move %1 by x %2 y %3 z %4', BLOCK_COLOURS.motion, 'Moves an object by an offset.'),
  vectorAction('zino_rotate', 'rotate %1 by x %2 y %3 z %4 degrees', BLOCK_COLOURS.motion, 'Rotates an object.'),
  vectorAction('zino_set_position', 'set position of %1 to x %2 y %3 z %4', BLOCK_COLOURS.motion, 'Places an object at an exact position.'),
  vectorAction('zino_set_rotation', 'set rotation of %1 to x %2 y %3 z %4', BLOCK_COLOURS.motion, 'Sets the rotation of an object in degrees.'),
  {
    type: 'zino_get_axis',
    message0: '%1 position of %2',
    args0: [
      { type: 'field_dropdown', name: 'AXIS', options: [['x', 'X'], ['y', 'Y'], ['z', 'Z']] },
      { type: 'input_value', name: 'OBJ', check: 'Object' },
    ],
    inputsInline: true,
    output: 'Number',
    colour: BLOCK_COLOURS.motion,
    tooltip: 'Reads the position of an object.',
  },

  // ── Physics ───────────────────────────────────────────────
  vectorAction('zino_apply_force', 'push %1 with force x %2 y %3 z %4', BLOCK_COLOURS.physics, 'Gives a physics object an instant push.'),

  // ── Objects ───────────────────────────────────────────────
  { type: 'zino_self', message0: 'this object', output: 'Object', colour: BLOCK_COLOURS.objects, tooltip: 'The object this script belongs to.' },
  { type: 'zino_other', message0: 'touched object', output: 'Object', colour: BLOCK_COLOURS.objects, tooltip: 'The object that was touched (only in "when touched").' },
  {
    type: 'zino_find',
    message0: 'object named %1',
    args0: [{ type: 'input_value', name: 'NAME', check: 'String' }],
    output: 'Object',
    colour: BLOCK_COLOURS.objects,
    tooltip: 'Finds an object by its name.',
  },
  {
    type: 'zino_destroy',
    message0: 'destroy %1',
    args0: [{ type: 'input_value', name: 'OBJ', check: 'Object' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.objects,
    tooltip: 'Removes an object from the game.',
  },

  // ── Game ──────────────────────────────────────────────────
  {
    type: 'zino_show_message',
    message0: 'show message %1',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.game,
    tooltip: 'Shows a message on screen.',
  },
  {
    type: 'zino_add_score',
    message0: 'change score by %1',
    args0: [{ type: 'input_value', name: 'AMOUNT', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.game,
    tooltip: 'Adds to the score (use a negative number to subtract).',
  },
  {
    type: 'zino_set_score',
    message0: 'set score to %1',
    args0: [{ type: 'input_value', name: 'AMOUNT', check: 'Number' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.game,
    tooltip: 'Sets the score.',
  },
  { type: 'zino_get_score', message0: 'score', output: 'Number', colour: BLOCK_COLOURS.game, tooltip: 'The current score.' },
  {
    type: 'zino_play_sound',
    message0: 'play sound %1',
    args0: [{ type: 'input_value', name: 'NAME', check: 'String' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.game,
    tooltip: 'Plays a sound: an imported audio asset name, or "beep", "coin", "jump", "hit".',
  },
  {
    type: 'zino_log',
    message0: 'log %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.game,
    tooltip: 'Writes a value to the Console.',
  },

  // ── Input ─────────────────────────────────────────────────
  {
    type: 'zino_is_pressed',
    message0: '%1 button is held',
    args0: [{ type: 'field_dropdown', name: 'BUTTON', options: BUTTON_OPTIONS }],
    output: 'Boolean',
    colour: BLOCK_COLOURS.input,
    tooltip: 'True while the button is held down.',
  },
  { type: 'zino_dt', message0: 'frame time', output: 'Number', colour: BLOCK_COLOURS.input, tooltip: 'Seconds since the last frame (only in "every frame").' },

  // ── Logic ─────────────────────────────────────────────────
  {
    type: 'zino_if',
    message0: 'if %1',
    args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
    message1: 'then %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.logic,
    tooltip: 'Runs the blocks inside when the condition is true.',
  },
  {
    type: 'zino_if_else',
    message0: 'if %1',
    args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
    message1: 'then %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    message2: 'else %1',
    args2: [{ type: 'input_statement', name: 'ELSE' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.logic,
    tooltip: 'Runs one set of blocks when true, the other when false.',
  },
  {
    type: 'zino_compare',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A' },
      { type: 'field_dropdown', name: 'OP', options: COMPARE_OP_OPTIONS },
      { type: 'input_value', name: 'B' },
    ],
    inputsInline: true,
    output: 'Boolean',
    colour: BLOCK_COLOURS.logic,
    tooltip: 'Compares two values.',
  },
  {
    type: 'zino_logic',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A', check: 'Boolean' },
      { type: 'field_dropdown', name: 'OP', options: LOGIC_OP_OPTIONS },
      { type: 'input_value', name: 'B', check: 'Boolean' },
    ],
    inputsInline: true,
    output: 'Boolean',
    colour: BLOCK_COLOURS.logic,
    tooltip: '"and" is true when both are true; "or" when either is true.',
  },
  {
    type: 'zino_not',
    message0: 'not %1',
    args0: [{ type: 'input_value', name: 'VALUE', check: 'Boolean' }],
    output: 'Boolean',
    colour: BLOCK_COLOURS.logic,
    tooltip: 'Flips true and false.',
  },
  {
    type: 'zino_boolean',
    message0: '%1',
    args0: [{ type: 'field_dropdown', name: 'BOOL', options: [['true', 'TRUE'], ['false', 'FALSE']] }],
    output: 'Boolean',
    colour: BLOCK_COLOURS.logic,
    tooltip: 'True or false.',
  },

  // ── Loops ─────────────────────────────────────────────────
  {
    type: 'zino_repeat',
    message0: 'repeat %1 times',
    args0: [{ type: 'input_value', name: 'TIMES', check: 'Number' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.loops,
    tooltip: 'Repeats the blocks inside a number of times.',
  },
  {
    type: 'zino_while',
    message0: 'repeat while %1',
    args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.loops,
    tooltip: 'Repeats while the condition is true (stopped automatically after 10,000 times).',
  },

  // ── Math ──────────────────────────────────────────────────
  {
    type: 'zino_number',
    message0: '%1',
    args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
    output: 'Number',
    colour: BLOCK_COLOURS.math,
    tooltip: 'A number.',
  },
  {
    type: 'zino_arith',
    message0: '%1 %2 %3',
    args0: [
      { type: 'input_value', name: 'A' },
      { type: 'field_dropdown', name: 'OP', options: ARITH_OP_OPTIONS },
      { type: 'input_value', name: 'B' },
    ],
    inputsInline: true,
    output: null,
    colour: BLOCK_COLOURS.math,
    tooltip: 'Add, subtract, multiply or divide. "+" also joins text.',
  },
  {
    type: 'zino_negate',
    message0: '− %1',
    args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }],
    output: 'Number',
    colour: BLOCK_COLOURS.math,
    tooltip: 'Makes a number negative.',
  },
  {
    type: 'zino_random',
    message0: 'random from %1 to %2',
    args0: [
      { type: 'input_value', name: 'MIN', check: 'Number' },
      { type: 'input_value', name: 'MAX', check: 'Number' },
    ],
    inputsInline: true,
    output: 'Number',
    colour: BLOCK_COLOURS.math,
    tooltip: 'A random number between two values.',
  },
  {
    type: 'zino_text',
    message0: '“%1”',
    args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
    output: 'String',
    colour: BLOCK_COLOURS.text,
    tooltip: 'A piece of text.',
  },

  // ── Variables ─────────────────────────────────────────────
  {
    type: 'zino_var_create',
    message0: 'create variable %1 = %2',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'count' },
      { type: 'input_value', name: 'VALUE' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.variables,
    tooltip: 'Creates a variable. Outside events it belongs to the whole script.',
  },
  {
    type: 'zino_var_set',
    message0: 'set %1 to %2',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'count' },
      { type: 'input_value', name: 'VALUE' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.variables,
    tooltip: 'Changes the value of a variable.',
  },
  {
    type: 'zino_var_change',
    message0: '%1 %2 by %3',
    args0: [
      { type: 'field_dropdown', name: 'OP', options: ASSIGN_OP_OPTIONS },
      { type: 'field_input', name: 'NAME', text: 'count' },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.variables,
    tooltip: 'Increases, decreases, multiplies or divides a variable.',
  },
  {
    type: 'zino_var_get',
    message0: '%1',
    args0: [{ type: 'field_input', name: 'NAME', text: 'count' }],
    output: null,
    colour: BLOCK_COLOURS.variables,
    tooltip: 'The value of a variable.',
  },

  // ── Comment ───────────────────────────────────────────────
  {
    type: 'zino_comment',
    message0: 'note: %1',
    // field_input (core) — Blockly 12 moved the multi-line field to a plugin.
    // Multi-line comments become one note block per line.
    args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_COLOURS.comment,
    tooltip: 'A note for people. It does not run.',
  },
];

export const EVENT_BLOCK_TYPES: Record<string, 'start' | 'update' | 'collision' | 'button'> = {
  zino_on_start: 'start',
  zino_on_update: 'update',
  zino_on_collision: 'collision',
  zino_on_button: 'button',
};

/** Toolbox categories shown in the block editor (with default inputs as shadow blocks). */
export function buildToolbox(): Json {
  const num = (n: number): Json => ({ shadow: { type: 'zino_number', fields: { NUM: n } } });
  const text = (t: string): Json => ({ shadow: { type: 'zino_text', fields: { TEXT: t } } });
  const self: Json = { shadow: { type: 'zino_self' } };
  const block = (type: string, inputs?: Json, fields?: Json): Json => ({
    kind: 'block',
    type,
    ...(inputs ? { inputs } : {}),
    ...(fields ? { fields } : {}),
  });
  const vector = (type: string, x: number, y: number, z: number) =>
    block(type, { OBJ: self, X: num(x), Y: num(y), Z: num(z) });

  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Events',
        colour: BLOCK_COLOURS.events,
        contents: [
          block('zino_on_start'),
          block('zino_on_update'),
          block('zino_on_collision'),
          block('zino_on_button'),
        ],
      },
      {
        kind: 'category',
        name: 'Motion',
        colour: BLOCK_COLOURS.motion,
        contents: [
          vector('zino_move', 0, 1, 0),
          vector('zino_rotate', 0, 90, 0),
          vector('zino_set_position', 0, 5, 0),
          vector('zino_set_rotation', 0, 0, 0),
          block('zino_get_axis', { OBJ: self }),
        ],
      },
      {
        kind: 'category',
        name: 'Physics',
        colour: BLOCK_COLOURS.physics,
        contents: [vector('zino_apply_force', 0, 5, 0)],
      },
      {
        kind: 'category',
        name: 'Objects',
        colour: BLOCK_COLOURS.objects,
        contents: [
          block('zino_self'),
          block('zino_other'),
          block('zino_find', { NAME: text('Cube') }),
          block('zino_destroy', { OBJ: { shadow: { type: 'zino_other' } } }),
        ],
      },
      {
        kind: 'category',
        name: 'Game',
        colour: BLOCK_COLOURS.game,
        contents: [
          block('zino_show_message', { TEXT: text('Hello!') }),
          block('zino_add_score', { AMOUNT: num(1) }),
          block('zino_set_score', { AMOUNT: num(0) }),
          block('zino_get_score'),
          block('zino_play_sound', { NAME: text('coin') }),
          block('zino_log', { VALUE: text('Hello') }),
        ],
      },
      {
        kind: 'category',
        name: 'Input',
        colour: BLOCK_COLOURS.input,
        contents: [block('zino_is_pressed'), block('zino_dt')],
      },
      {
        kind: 'category',
        name: 'Logic',
        colour: BLOCK_COLOURS.logic,
        contents: [
          block('zino_if'),
          block('zino_if_else'),
          block('zino_compare', { A: num(0), B: num(0) }),
          block('zino_logic'),
          block('zino_not'),
          block('zino_boolean'),
        ],
      },
      {
        kind: 'category',
        name: 'Loops',
        colour: BLOCK_COLOURS.loops,
        contents: [block('zino_repeat', { TIMES: num(3) }), block('zino_while')],
      },
      {
        kind: 'category',
        name: 'Math',
        colour: BLOCK_COLOURS.math,
        contents: [
          block('zino_number'),
          block('zino_arith', { A: num(1), B: num(1) }),
          block('zino_negate', { VALUE: num(1) }),
          block('zino_random', { MIN: num(1), MAX: num(10) }),
          block('zino_text'),
        ],
      },
      {
        kind: 'category',
        name: 'Variables',
        colour: BLOCK_COLOURS.variables,
        contents: [
          block('zino_var_create', { VALUE: num(0) }),
          block('zino_var_set', { VALUE: num(0) }),
          block('zino_var_change', { VALUE: num(1) }),
          block('zino_var_get'),
        ],
      },
      {
        kind: 'category',
        name: 'Notes',
        colour: BLOCK_COLOURS.comment,
        contents: [block('zino_comment', undefined, { TEXT: 'Write a note here' })],
      },
    ],
  };
}
