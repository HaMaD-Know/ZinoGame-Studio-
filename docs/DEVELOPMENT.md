# Development guide

## Requirements

- Node.js **22** (see `.nvmrc`) and npm.
- For native iOS work: a Mac with Xcode 26 (optional — CI builds without one).

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install exact dependency versions from `package-lock.json` |
| `npm run dev` | Vite dev server (open the printed URL; on an iPad on the same network use the "Network" URL) |
| `npm run typecheck` | TypeScript project build check (`tsc -b`, strict) |
| `npm run lint` | ESLint (incl. React hooks rules and a ban on `eval`/`new Function`) |
| `npm test` | Vitest unit + integration tests (engine runs headless in Node, incl. real Rapier physics) |
| `npm run build:web` | Production web build into `dist/` |
| `npm run build` | Type check + production build |
| `npm run check:capacitor` | Validate Capacitor/iOS/workflow configuration (needs `dist/`) |
| `npm run test:e2e` | Playwright end-to-end tests in Chromium (desktop, iPad landscape, iPad portrait) — needs `npm run build:web` first |
| `npm run test:e2e:webkit` | Same tests in Playwright WebKit with iPad Pro emulation (`npx playwright install webkit` first) |
| `npm run check` | typecheck + lint + tests + web build |
| `npm run ios:build` | Build and `cap sync ios` (then `npx cap open ios` on a Mac) |

## Tests

- `src/engine/**/*.test.ts` — scene operations, baseplate, undo/redo, project
  validation/migration/corruption, storage (IndexedDB via `fake-indexeddb` and
  memory), zip archives, scripting (parser, printer, analyzer, interpreter limits,
  blocks ⇄ text), importers (generated GLB), renderer sync, headless game runtime.
- `src/editor/EditorSession.test.ts` — session commands, undo, autosave, drafts,
  save failures, play-mode locking.
- `tests/buildConfig.test.ts` — Capacitor/iOS/workflow validation.
- `e2e/editor.spec.ts` — browser tests: create/edit/reload a project, baseplate
  controls, Play/Stop, viewport tap selection, block script editor.

Playwright WebKit is **not** the same as iPadOS Safari or the Capacitor
WKWebView. Before a release, test on a real iPad (Safari and the installed app).

## Project structure

```
src/
  app/            App shell, routing/controller, preferences, services
  components/     Design-system components (buttons, fields, dialogs, menus, toasts)
  editor/         EditorSession store, asset cache registry
  engine/         Framework-agnostic engine (see ARCHITECTURE.md)
  features/       home, scene-editor, hierarchy, inspector, assets, scripts,
                  play-mode, settings, tutorials
  platform/       Capacitor/web platform abstraction
  styles/         global.css (tokens, themes, controls), editor.css (layouts)
  utils/
public/icons/     Web icons generated from the logo
resources/        Logo source and the 1024px iOS icon
ios/              Capacitor iOS project (Swift Package Manager)
scripts/          Configuration validator and CI helpers
docs/             Documentation
e2e/              Playwright tests
```

## Extending

- **New object type**: add to `ObjectType` (`engine/scene/types.ts`), defaults in
  `factory.ts`, building/updating in `renderer/SceneSync.ts`, normalisation in
  `project/validation.ts`, an icon in `components/icons.tsx`, and an entry in
  `ADD_OBJECT_ITEMS`.
- **New script function**: add it to `BUILTINS` in `engine/scripting/api.ts`, a
  `ScriptHost` method if it needs the game, and a case in the interpreter's
  `builtin()` switch. For a block: add a definition in `blocks/definitions.ts`,
  both conversion directions in `blocks/convert.ts`, and a round-trip test.
- **New importer**: implement `AssetImporter` in `engine/assets/importers.ts` and
  add it to `IMPORTERS`.
- **Project format change**: see "Migrations" in PROJECT_FORMAT.md.

## Debugging on an iPad

- Web: run `npm run dev`, open the Network URL in Safari on the iPad.
- Native Debug build: Safari on a Mac → Develop → your iPad → ZinoGame Studio
  (`webContentsDebuggingEnabled` is on in `capacitor.config.ts`).
- In the app, switch to **Advanced** mode to see the Console, collider view and
  the code editor.

## Dependency notes

- `vitest` is pinned to 4.0.x because 4.1.x triggers an npm 10 resolver crash
  (`Cannot read properties of null (reading 'edgesOut')`) in this dependency tree.
- `jsdom` matches the version Blockly depends on, to avoid duplicate trees.
- Blockly's UI media is served from `node_modules/blockly/media` by a small Vite
  plugin and copied into the build, so nothing is fetched from the internet.
