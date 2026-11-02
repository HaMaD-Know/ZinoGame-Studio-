# Zino Script and visual scripting

ZinoGame Studio scripts can be written with **blocks** (Blockly) or as **text**
(Zino Script). Both are views of the same versioned intermediate representation
(IR), so a script can move between them when it only uses features blocks support.

## The language

```zino
// Script-level variables live as long as the game runs.
var speed = 4

on start {
  showMessage("Hello from " + nameOf(self) + "!")
}

on update {
  rotate(self, 0, 90 * dt, 0)
  if (isPressed("forward")) {
    move(self, 0, 0, -speed * dt)
  }
}

on collision {
  addScore(1)
  playSound("coin")
  destroy(other)
}

on button("jump") {
  applyForce(self, 0, 6, 0)
}

// Custom functions are text-only for now.
function clamp(v, lo, hi) {
  return min(max(v, lo), hi)
}
```

### Rules

- All code lives inside an **event** (`on start`, `on update`, `on collision`,
  `on button("name")`), a top-level `var`, or a `function`.
- Statements end at a new line (or `;`). A binary operator must be on the same
  line as its left side, unless inside parentheses — no surprise "automatic semicolons".
- Variables must be created before use: `var` (script-wide) or `let` (block-local).
- Implicit names: `self` (the object the script is attached to), `other` (only in
  `on collision`), `dt` (seconds since the last frame, only in `on update`).
- Values: numbers, text (`"..."` or `'...'`), `true`/`false`, `null`, objects.
- Operators: `+ - * / %`, `== != < <= > >=`, `&& || !`, assignments `= += -= *= /=`.
  `+` joins text when either side is text.
- Statements: `if/else`, `repeat (n) { }`, `while (cond) { }`, `break`, `continue`, `return`.
- Comments: `// line` and `/* block */`. Comments are kept as IR nodes, so formatting
  and block conversion never delete them (they become **note** blocks).
- Buttons: `jump` (Space), `action` (E/Enter), `forward`/`back`/`left`/`right`
  (WASD/arrows), plus single letters and digits. On touch screens the joystick drives
  movement and on-screen *Jump*/*Action* buttons fire button events.

The full, always-current API (names, parameters, docs, examples) is defined in
[`src/engine/scripting/api.ts`](../src/engine/scripting/api.ts) and shown in-app via
**Scripts → Script API reference**.

| Category | Functions |
|---|---|
| Motion | `move`, `rotate`, `setPosition`, `setRotation`, `setScale`, `getX`, `getY`, `getZ`, `distance` |
| Physics | `applyForce` (instant push), `setVelocity` |
| Objects | `find("Name")`, `destroy`, `setVisible`, `setColor("#rrggbb")`, `exists`, `nameOf` |
| Game | `showMessage`, `addScore`, `setScore`, `getScore`, `time` |
| Sound | `playSound(name)` — an imported audio asset by name, or built-in `beep`, `coin`, `jump`, `hit` |
| Input | `isPressed(button)` |
| Math | `random`, `randomInt`, `abs`, `min`, `max`, `sqrt`, `round`, `floor`, `sin`, `cos` (degrees) |
| Debug | `log(value)` → Console panel |

## Intermediate representation (IR v1)

Defined in [`src/engine/scripting/ast.ts`](../src/engine/scripting/ast.ts):

```ts
interface Program { irVersion: 1; body: TopLevel[] }
type TopLevel = VarDecl | EventHandler | FunctionDecl | Comment;
type Stmt = Let | Assign | If | Repeat | While | ExprStmt | Return | Break | Continue | Comment;
type Expr = Number | String | Boolean | Null | Identifier | Unary | Binary | Call;
```

Every node may carry `id` (the Blockly block id it came from) and `loc` (line and
column in the text it was parsed from). The `irVersion` field allows future
migrations of stored scripts.

### Pipeline

```
 Blockly workspace JSON ──blocksToProgram──▶ IR ──printProgram──▶ text + source map
 text ──parse──▶ IR ──programToBlocks──▶ Blockly workspace JSON  (only if supported)
 IR ──analyzeProgram──▶ diagnostics       IR ──ScriptInstance──▶ execution
```

- **Blocks → text** always works. The printer returns a *source map*
  (`nodeId → line range`): tapping a block highlights its code, tapping a line
  selects its block.
- **Text → blocks** works when `findUnsupportedForBlocks` reports nothing.
  Otherwise the editor explains what is not supported (custom functions,
  `return`/`break`/`continue`, `null`, functions without blocks such as `setScale`,
  `isPressed` with a non-literal button) and the script **stays as text**, untouched.
- When converting text → blocks, the original text is stored in `textBackup`, and
  Advanced mode offers *Restore original code*.
- Blocks that are not inside an event ("loose" blocks) do not run. Switching to text
  warns before leaving them out.
- Converters operate on plain JSON, so they are unit-tested without Blockly or a DOM.

### Blocks

Defined as JSON in [`src/engine/scripting/blocks/definitions.ts`](../src/engine/scripting/blocks/definitions.ts).

| Group | Blocks |
|---|---|
| Events | when the game starts · every frame · when this object touches something · when ⟨button⟩ is pressed |
| Motion | move · rotate · set position · set rotation · ⟨x/y/z⟩ position of |
| Physics | push with force |
| Objects | this object · touched object · object named · destroy |
| Game | show message · change score by · set score to · score · play sound · log |
| Input | ⟨button⟩ is held · frame time |
| Logic | if · if/else · compare · and/or · not · true/false |
| Loops | repeat N times · repeat while |
| Math | number · + − × ÷ remainder · negate · random |
| Variables | create variable · set · increase/decrease/multiply/divide · get |
| Notes | note (a comment) |

Only Blockly **core** field types are allowed (a test enforces this): plugin fields
would silently drop data when the plugin is missing.

## Execution and security

Scripts run in a **tree-walking interpreter**
([`interpreter.ts`](../src/engine/scripting/interpreter.ts)) — never through
`eval`, `new Function` or dynamic imports (ESLint forbids those).

- Identifiers resolve only to script variables, function parameters and the
  implicit names. There is no property access (`a.b`), so scripts cannot reach
  JavaScript objects, the DOM, storage or editor internals.
- Every effect goes through the narrow `ScriptHost` interface implemented by the
  game runtime.
- **Limits** per event dispatch: 100,000 evaluation steps, 10,000 iterations per
  loop, 64 nested function calls, 10,000 characters per text value. Exceeding a
  limit stops that script instance with a clear message and line number; the game
  keeps running.
- Runtime errors (type mismatches, division by zero, unknown objects) are reported
  with the script name, object name and line, in the Play overlay and the Console.
- Scripts are statically checked before Play (unknown names, wrong argument counts,
  `dt`/`other` outside their events, `break` outside loops). Scripts with errors are
  not started; the rest of the game still runs.

## Editors

- **Blocks**: Blockly with the touch-friendly *Zelos* renderer, local media (works
  offline), live diagnostics shown as warnings on the blocks themselves.
- **Text** (Advanced mode): Monaco with Zino syntax highlighting, completion, hover
  docs and markers. On touch-only devices (or if Monaco fails to load) a simple
  editor with line numbers, error markers and auto-indent is used instead. Choose in
  **Settings → Code editor**.
- **Tidy code** reformats only code that parses, so formatting can never lose text.
