import type { EventName } from './ast';

/**
 * The complete, documented Zino Script API. Scripts can only call functions
 * listed here (plus their own `function`s). This table drives the analyzer,
 * the interpreter's dispatch, editor autocompletion and the in-app docs.
 */

export type ValueType = 'number' | 'string' | 'boolean' | 'object' | 'any' | 'void';

export interface ParamSpec {
  name: string;
  type: ValueType;
}

export type ApiCategory = 'motion' | 'physics' | 'objects' | 'game' | 'sound' | 'input' | 'math' | 'debug';

export interface BuiltinSpec {
  name: string;
  params: ParamSpec[];
  returns: ValueType;
  category: ApiCategory;
  doc: string;
  example: string;
  /** Blockly block type that represents this call, if any. */
  block?: string;
}

const xyz = (prefix = ''): ParamSpec[] => [
  { name: `${prefix}x`, type: 'number' },
  { name: `${prefix}y`, type: 'number' },
  { name: `${prefix}z`, type: 'number' },
];
const obj: ParamSpec = { name: 'object', type: 'object' };

export const BUILTINS: BuiltinSpec[] = [
  // Motion
  { name: 'move', params: [obj, ...xyz()], returns: 'void', category: 'motion', block: 'zino_move',
    doc: 'Moves an object by an offset in world units.', example: 'move(self, 0, 1, 0)' },
  { name: 'rotate', params: [obj, ...xyz()], returns: 'void', category: 'motion', block: 'zino_rotate',
    doc: 'Rotates an object by the given angles in degrees.', example: 'rotate(self, 0, 90 * dt, 0)' },
  { name: 'setPosition', params: [obj, ...xyz()], returns: 'void', category: 'motion', block: 'zino_set_position',
    doc: 'Places an object at an exact world position.', example: 'setPosition(self, 0, 5, 0)' },
  { name: 'setRotation', params: [obj, ...xyz()], returns: 'void', category: 'motion', block: 'zino_set_rotation',
    doc: 'Sets the rotation of an object in degrees.', example: 'setRotation(self, 0, 45, 0)' },
  { name: 'setScale', params: [obj, ...xyz()], returns: 'void', category: 'motion',
    doc: 'Sets the size multiplier of an object.', example: 'setScale(self, 2, 2, 2)' },
  { name: 'getX', params: [obj], returns: 'number', category: 'motion', block: 'zino_get_axis',
    doc: 'The X position of an object.', example: 'let x = getX(self)' },
  { name: 'getY', params: [obj], returns: 'number', category: 'motion', block: 'zino_get_axis',
    doc: 'The Y (height) position of an object.', example: 'if (getY(self) < -20) { ... }' },
  { name: 'getZ', params: [obj], returns: 'number', category: 'motion', block: 'zino_get_axis',
    doc: 'The Z position of an object.', example: 'let z = getZ(self)' },
  { name: 'distance', params: [{ name: 'a', type: 'object' }, { name: 'b', type: 'object' }], returns: 'number',
    category: 'motion', doc: 'Distance between two objects.', example: 'if (distance(self, find("Player")) < 3) { ... }' },
  // Physics
  { name: 'applyForce', params: [obj, ...xyz()], returns: 'void', category: 'physics', block: 'zino_apply_force',
    doc: 'Gives a physics object an instant push (impulse). The object needs a Physics Body.',
    example: 'applyForce(self, 0, 5, 0)' },
  { name: 'setVelocity', params: [obj, ...xyz()], returns: 'void', category: 'physics',
    doc: 'Sets the velocity of a physics object.', example: 'setVelocity(self, 0, 0, 0)' },
  // Objects
  { name: 'find', params: [{ name: 'name', type: 'string' }], returns: 'object', category: 'objects', block: 'zino_find',
    doc: 'Finds an object in the scene by its name. Returns null when nothing matches.',
    example: 'let door = find("Door")' },
  { name: 'destroy', params: [obj], returns: 'void', category: 'objects', block: 'zino_destroy',
    doc: 'Removes an object from the running game.', example: 'destroy(other)' },
  { name: 'setVisible', params: [obj, { name: 'visible', type: 'boolean' }], returns: 'void', category: 'objects',
    doc: 'Shows or hides an object.', example: 'setVisible(self, false)' },
  { name: 'setColor', params: [obj, { name: 'color', type: 'string' }], returns: 'void', category: 'objects',
    doc: 'Changes the colour of an object, using a hex colour like "#ff0000".', example: 'setColor(self, "#ff0000")' },
  { name: 'exists', params: [obj], returns: 'boolean', category: 'objects',
    doc: 'True while the object is still in the game.', example: 'if (exists(other)) { ... }' },
  { name: 'nameOf', params: [obj], returns: 'string', category: 'objects',
    doc: 'The name of an object.', example: 'showMessage("Hit " + nameOf(other))' },
  // Game
  { name: 'showMessage', params: [{ name: 'text', type: 'any' }], returns: 'void', category: 'game',
    block: 'zino_show_message', doc: 'Shows a message on screen.', example: 'showMessage("You win!")' },
  { name: 'addScore', params: [{ name: 'amount', type: 'number' }], returns: 'void', category: 'game',
    block: 'zino_add_score', doc: 'Changes the score by an amount (use a negative number to subtract).',
    example: 'addScore(1)' },
  { name: 'setScore', params: [{ name: 'value', type: 'number' }], returns: 'void', category: 'game',
    block: 'zino_set_score', doc: 'Sets the score.', example: 'setScore(0)' },
  { name: 'getScore', params: [], returns: 'number', category: 'game', block: 'zino_get_score',
    doc: 'The current score.', example: 'if (getScore() >= 10) { ... }' },
  { name: 'time', params: [], returns: 'number', category: 'game',
    doc: 'Seconds since the game started.', example: 'let t = time()' },
  // Sound
  { name: 'playSound', params: [{ name: 'name', type: 'string' }], returns: 'void', category: 'sound',
    block: 'zino_play_sound',
    doc: 'Plays an imported audio asset by name, or a built-in sound: "beep", "coin", "jump", "hit".',
    example: 'playSound("coin")' },
  // Input
  { name: 'isPressed', params: [{ name: 'button', type: 'string' }], returns: 'boolean', category: 'input',
    block: 'zino_is_pressed', doc: 'True while a button is held down.', example: 'if (isPressed("left")) { ... }' },
  // Math
  { name: 'random', params: [{ name: 'min', type: 'number' }, { name: 'max', type: 'number' }], returns: 'number',
    category: 'math', block: 'zino_random', doc: 'A random number between min and max.', example: 'random(1, 6)' },
  { name: 'randomInt', params: [{ name: 'min', type: 'number' }, { name: 'max', type: 'number' }], returns: 'number',
    category: 'math', doc: 'A random whole number from min to max (inclusive).', example: 'randomInt(1, 6)' },
  { name: 'abs', params: [{ name: 'value', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Absolute value.', example: 'abs(-3)' },
  { name: 'min', params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }], returns: 'number',
    category: 'math', doc: 'The smaller of two numbers.', example: 'min(a, b)' },
  { name: 'max', params: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }], returns: 'number',
    category: 'math', doc: 'The larger of two numbers.', example: 'max(a, b)' },
  { name: 'sqrt', params: [{ name: 'value', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Square root.', example: 'sqrt(16)' },
  { name: 'round', params: [{ name: 'value', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Rounds to the nearest whole number.', example: 'round(2.6)' },
  { name: 'floor', params: [{ name: 'value', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Rounds down.', example: 'floor(2.6)' },
  { name: 'sin', params: [{ name: 'degrees', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Sine of an angle in degrees.', example: 'sin(time() * 90)' },
  { name: 'cos', params: [{ name: 'degrees', type: 'number' }], returns: 'number', category: 'math',
    doc: 'Cosine of an angle in degrees.', example: 'cos(time() * 90)' },
  // Debug
  { name: 'log', params: [{ name: 'value', type: 'any' }], returns: 'void', category: 'debug', block: 'zino_log',
    doc: 'Writes a value to the Console panel.', example: 'log("Hello")' },
];

export const BUILTIN_MAP: ReadonlyMap<string, BuiltinSpec> = new Map(BUILTINS.map((b) => [b.name, b]));

export interface ImplicitVariable {
  name: string;
  doc: string;
  /** Events where this variable exists; null = everywhere. */
  events: EventName[] | null;
}

export const IMPLICIT_VARIABLES: ImplicitVariable[] = [
  { name: 'self', doc: 'The object this script is attached to.', events: null },
  { name: 'other', doc: 'The object that was touched (collision events only).', events: ['collision'] },
  { name: 'dt', doc: 'Seconds since the last frame (update events only). Multiply speeds by dt.', events: ['update'] },
];

export const RESERVED_NAMES = new Set([
  ...IMPLICIT_VARIABLES.map((v) => v.name),
  ...BUILTINS.map((b) => b.name),
]);

/** Named buttons. Single letters a–z and digits 0–9 are also valid button names. */
export const NAMED_BUTTONS: { name: string; label: string; keys: string }[] = [
  { name: 'jump', label: 'Jump', keys: 'Space' },
  { name: 'action', label: 'Action', keys: 'E / Enter' },
  { name: 'forward', label: 'Forward', keys: 'W / ↑' },
  { name: 'back', label: 'Back', keys: 'S / ↓' },
  { name: 'left', label: 'Left', keys: 'A / ←' },
  { name: 'right', label: 'Right', keys: 'D / →' },
];

export function isValidButtonName(name: string): boolean {
  return NAMED_BUTTONS.some((b) => b.name === name) || /^[a-z0-9]$/.test(name);
}

export const EVENT_DOCS: Record<EventName, string> = {
  start: 'Runs once when the game starts.',
  update: 'Runs every frame. Use dt to make movement smooth.',
  collision: 'Runs when this object touches another object. Use other for the object that was touched.',
  button: 'Runs when a button is pressed (keyboard or on-screen button).',
};
