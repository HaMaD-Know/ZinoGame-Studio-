<p align="center"><img src="public/icons/icon-192.png" width="120" alt="ZinoGame Studio logo"></p>

# ZinoGame Studio

A beginner-friendly **3D game creation studio**, built iPad-first. Start from a
baseplate, add and arrange objects, snap together block scripts (or write Zino
Script code), and press **Play** to walk around your world.

Built with React, TypeScript, Vite, Three.js, Rapier physics, Blockly and Monaco,
and packaged for iOS/iPadOS with Capacitor. The native app is built on
GitHub-hosted macOS runners, so **no Mac is required**.

## What works today

- **Projects**: create from *Empty Baseplate* (default), *Empty 3D Scene* or
  *Simple 3D Playground*; three example games; autosave; backups; recovery of
  unsaved work; import/export as `.zinoproj.zip`.
- **Baseplate**: a real 512 × 512 surface with collision, size presets
  (128–1024) or custom sizes, surface presets, colour, visibility, collision
  toggle, reset, and an independent adaptive editor grid. Warns before deleting
  the ground under the player spawn.
- **3D editor**: orbit/pan/pinch-zoom camera, tap-to-select, move/rotate/scale
  gizmos (touch-sized), multi-select (Shift/⌘ or the hierarchy's *Select several* toggle), snapping, frame selection, hierarchy with
  search, rename, visibility, lock, grouping and touch drag-to-reorder/parent,
  context-sensitive inspector, copy/paste/duplicate, full undo/redo.
- **Objects**: cube, sphere, plane, cylinder, cone, sun/point/spot lights, camera,
  baseplate, player spawn, empty groups, imported models, prefabs.
- **Graphics**: PBR materials (colour, metal, roughness, glow, opacity,
  textures), toon / low-poly / unlit styles with outlines, gradient sky, fog,
  shadows, image-based lighting, Low/Medium/High quality presets.
- **Assets**: GLB/glTF models (with animations), PNG/JPEG/WebP textures,
  MP3/M4A/WAV sounds, saved materials and prefabs; progress, previews and clear
  error messages.
- **Scripting**: Blockly blocks and Zino Script text over one versioned IR, with
  block ⇄ code highlighting, diagnostics, safe conversion that never loses text,
  and a sandboxed interpreter with execution limits.
- **Play mode**: Rapier physics, collisions and triggers, a third/first-person
  player with on-screen joystick and buttons, score, messages, sounds, script
  error reporting; editor state is restored on Stop.
- **UI**: Beginner and Advanced modes, light/dark themes, responsive iPad
  landscape/portrait layouts, keyboard shortcuts, command search (⌘K),
  in-editor tutorials.

## Quick start

```bash
npm ci
npm run dev          # open the printed URL (use the Network URL on an iPad)
npm test             # unit/integration tests
npm run build:web    # production build in dist/
```

## Building the iPad app

Go to **Actions → iOS Build → Run workflow** on GitHub (works from Safari on an
iPad), then download the **`zinogame-studio-ios-build`** artifact. Without signing
secrets the workflow produces an *unsigned* `.ipa` (not installable as-is) and a
Simulator build; with your Apple signing secrets it produces an installable
`.ipa`. Full instructions: **[docs/IOS_BUILD.md](docs/IOS_BUILD.md)**.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules and design decisions
- [docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md) — project/scene/asset format, storage, migrations
- [docs/SCRIPTING.md](docs/SCRIPTING.md) — Zino Script, blocks, IR, sandbox
- [docs/IOS_BUILD.md](docs/IOS_BUILD.md) — CI build, artifacts, signing, installation
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — commands, tests, structure, extending

## Current limitations

- Only one scene per project in the UI (the format supports several).
- No standalone game export yet; games run in the editor's Play mode. Projects
  are shared as `.zinoproj.zip` files.
- Rendering uses WebGL 2; WebGPU is detected but not used yet.
- Models: glTF 2.0 only (`.glb`, or `.gltf` with embedded data); Draco/Meshopt/KTX2
  compression and FBX/OBJ are not supported. Imported models get a box collider.
- No animation editor, terrain sculpting, networking or multiplayer.
- Signed iOS builds need an Apple Developer account and secrets; the signed CI
  path is implemented but has not been run without real credentials.
- Tested in Chromium and Playwright WebKit; real-iPad testing is still needed.
