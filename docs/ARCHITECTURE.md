# Architecture

ZinoGame Studio is a React + TypeScript single-page app built with Vite and
packaged for iOS with Capacitor. The core rule: **the engine never depends on
React**. React renders panels; the 3D viewport, runtime, physics, scripting and
storage are plain TypeScript modules that can be tested headless in Node.

```
┌───────────────────────── React UI (src/features, src/components, src/app) ─────────────────────────┐
│ Home · Create (toolbar, hierarchy, viewport host, inspector, bottom panel) · Assets · Scripts ·     │
│ Settings · Play overlay                                                                            │
└──────────────┬───────────────────────────────┬──────────────────────────────┬─────────────────────┘
               │ useSyncExternalStore           │ mount/dispose                │ lazy import
┌──────────────▼──────────────┐  ┌──────────────▼──────────────┐  ┌────────────▼─────────────────────┐
│ EditorSession (src/editor)  │  │ EditorViewport              │  │ Blockly / Monaco editors         │
│ project, selection, tools,  │──▶ (engine/editor-viewport)    │  │ (features/scripts)               │
│ undo history, autosave,     │  │ OrbitControls, gizmos,      │  └────────────┬─────────────────────┘
│ console, scripts, assets    │  │ picking, grids, helpers     │               │ JSON ⇄ IR
└──────┬───────────────┬──────┘  └──────────────┬──────────────┘  ┌────────────▼─────────────────────┐
       │               │                        │                 │ engine/scripting                  │
┌──────▼──────┐ ┌──────▼────────┐ ┌─────────────▼─────────────┐   │ lexer · parser · IR · printer ·   │
│ engine/scene│ │ engine/storage│ │ engine/renderer           │   │ analyzer · interpreter · blocks   │
│ data model, │ │ ProjectStorage│ │ SceneSync, materials, sky,│   └────────────┬─────────────────────┘
│ sceneOps,   │ │ IndexedDB /   │ │ grid, RenderContext,      │                │
│ baseplate   │ │ memory, zip   │ │ quality presets           │   ┌────────────▼─────────────────────┐
└─────────────┘ └───────────────┘ └─────────────┬─────────────┘   │ engine/runtime GameRuntime        │
                                                └─────────────────▶ physics (Rapier) · input · audio  │
                                                                  └──────────────────────────────────┘
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Core | `src/engine/core` | ids, vector math, emitter |
| Scene model | `src/engine/scene` | Immutable, JSON-serialisable `SceneData`; pure operations (`sceneOps`, `baseplate`); transform math |
| History | `src/engine/history` | Snapshot-based undo/redo with edit merging |
| Project | `src/engine/project` | Versioned format, templates/examples, validation + repair, migrations |
| Storage | `src/engine/storage` | `ProjectStorage` interface; IndexedDB and memory implementations; backups and recovery drafts |
| Serialisation | `src/engine/serialization` | `.zinoproj.zip` export/import with the folder layout in PROJECT_FORMAT.md |
| Renderer | `src/engine/renderer` | `RenderContext` (single WebGL context), `SceneSync` (data → Three.js), materials, sky, adaptive grid, quality presets |
| Editor viewport | `src/engine/editor-viewport` | Camera navigation, tap-to-select raycasting, transform gizmos, selection boxes, collider display, render-on-demand |
| Assets | `src/engine/assets` | Importer registry (GLB/glTF/images/audio), lazy `AssetCache` |
| Physics | `src/engine/physics` | Collider shape derivation; lazy-loaded Rapier wrapper with fixed timestep |
| Scripting | `src/engine/scripting` | Zino Script language, IR, Blockly conversion, sandboxed interpreter |
| Runtime | `src/engine/runtime` | Play mode: builds a separate game scene, physics, player, scripts |
| Input / Audio | `src/engine/input`, `src/engine/audio` | Unified buttons/joystick; WebAudio with synthesised built-in sounds |
| Editor session | `src/editor` | The single store for an open project; every edit goes through it |
| Platform | `src/platform` | Capacitor vs web: files, share sheet, lifecycle, status bar |
| UI | `src/app`, `src/components`, `src/features`, `src/styles` | React UI, design system, preferences |

## Key design decisions

**Immutable scene data + snapshot undo.** Every edit creates a new `SceneData`
with structural sharing. Undo entries store `before/after` references, so undo
is exact (hierarchy order, components, selection) and memory-cheap. Rapid edits
with the same `mergeKey` (e.g. scrubbing a number) merge into one step. Gizmo
drags use `previewSceneChange` (no history) and commit once on release.

**Incremental 3D sync.** `SceneSync` compares object references and only
touches changed objects. Each scene object has a `root` group (transform) and a
replaceable `content` child, so changing a type or a model never disturbs
children. Primitive geometries are shared unit-size meshes scaled by the
transform. Directional lights live in a world-space rig so their shadow map
follows the camera focus.

**Grid ≠ baseplate.** The baseplate is a plain grey box mesh (top surface at
y = 0). The grid is an independent editor-only shader overlay (`AdaptiveGrid`)
attached to the baseplate's transform; it never appears in play mode and never
alters the surface material.

**One GPU context.** The editor viewport and play mode share the
`RenderContext` canvas; play mode pauses the editor, renders its own scene and
hands the canvas back on stop. Model previews create one short-lived context.

**Render on demand.** The editor renders only when something changed (camera
movement, edits, async asset loads, damping), saving battery on tablets. Play
mode runs a normal `requestAnimationFrame` loop with `dt` clamped to 0.1 s.

**Play mode never mutates editor data.** `GameRuntime` receives a snapshot,
builds its own Three.js scene and physics world, and is thrown away on stop.

**Lazy heavy dependencies.** Rapier (WASM, ~2 MB), Blockly and Monaco are
loaded only when needed (play, block editor, code editor).

**Safety.** No `eval`/`new Function` (lint-enforced). Scripts are interpreted
from the IR with step, loop, recursion and string limits.

**Graphics abstraction.** Materials are described by `MaterialComponent`
(style `standard` | `toon` | `flat` | `unlit`), not by Three.js classes, so the
renderer can change (e.g. to WebGPU) without changing the project format.
WebGPU availability is detected and shown in Settings; the renderer is
currently WebGL 2 everywhere.

## Performance measures

- Pixel ratio capped per quality preset (1 / 1.5 / 2) — Retina iPads otherwise
  render 4–9× the pixels.
- Shadows only on Medium/High; shadow camera follows the view.
- Shared geometries, shared/cached model and texture assets, reference-safe disposal.
- Viewport subscribes to the session directly (no React re-render per drag frame).
- Autosave is debounced and asynchronous; thumbnails are small JPEGs.

## Export architecture (current and planned)

The editor and the game runtime are separate modules. The runtime
(`GameRuntime` + `SceneSync` in game mode + scripting + physics) does not import
any editor code, which is the foundation for a future **standalone web game
export** (a small player bundle that loads an exported project). Today, games
run inside the editor (Play) and projects are shared as `.zinoproj.zip`
archives. Native game exports (desktop, Android, iOS) are not implemented.
