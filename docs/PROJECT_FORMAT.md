# Project format (schema version 1)

A project is stored in IndexedDB on the device and can be exported as a
`.zinoproj.zip` archive for backup or transfer between devices.

## Archive layout

```
My Game/
  project.zino                  Manifest JSON + index of files
  Scenes/
    Main Scene.zscene           Scene JSON (objects, environment, editor camera)
  Scripts/
    Coin.zs                     Zino Script text (always present)
  VisualScripts/
    Coin.zblocks                Script metadata: id, mode, Blockly workspace JSON, textBackup
  Assets/
    assets.json                 Metadata for every asset
    Models/<id>-robot.glb
    Textures/<id>-grass.png
    Audio/<id>-coin.mp3
    Materials/<id>.zmat         Saved material (JSON)
    Prefabs/<id>.zprefab        Saved object group (JSON)
  Settings/
    project-settings.json       Player, render style, score display
  Builds/                       Reserved for exported game builds
```

`project.zino` contains a `files` index mapping scene, script and asset ids to
paths, so file names can be human-readable while references stay id-based.
Import looks for `project.zino` at the archive root or one folder deep.

## Manifest

```jsonc
{
  "format": "zinogame-project",
  "schemaVersion": 1,
  "id": "prj_…",                 // stable, never reused
  "name": "My Game",
  "description": "",
  "template": "empty-baseplate", // empty-baseplate | empty-3d | playground | example
  "createdAt": "ISO-8601", "updatedAt": "ISO-8601",
  "appVersion": "0.1.0",
  "mainSceneId": "scn_…",
  "sceneIds": ["scn_…"],
  "settings": {
    "player": { "enabled": true, "moveSpeed": 8, "jumpPower": 7, "cameraMode": "thirdPerson", "color": "#ffb02e" },
    "renderStyle": "realistic",
    "showScore": true
  }
}
```

## Scene

```jsonc
{
  "schemaVersion": 1,
  "id": "scn_…",
  "name": "Main Scene",
  "objects": [ /* ordered; order among siblings = hierarchy order */ ],
  "environment": {
    "background": "sky", "backgroundColor": "#20263a",
    "sky": { "topColor": "#4a8fe7", "horizonColor": "#cfe6ff", "bottomColor": "#8a9bb0" },
    "ambientColor": "#bcd4ff", "ambientIntensity": 0.6, "environmentIntensity": 0.6,
    "fog": { "enabled": false, "color": "#cfe6ff", "near": 150, "far": 600 },
    "gravity": -9.81
  },
  "editorView": { "cameraPosition": [9, 7, 13], "cameraTarget": [0, 1, 0] }
}
```

### Scene object

```jsonc
{
  "id": "obj_…",                 // stable unique id
  "name": "Baseplate",
  "type": "baseplate",           // empty cube sphere plane cylinder cone directionalLight pointLight spotLight camera baseplate spawnPoint model
  "parentId": null,              // id of the parent object, or null
  "transform": { "position": [0,0,0], "rotation": [0,0,0] /* degrees, XYZ */, "scale": [1,1,1] },
  "visible": true,
  "locked": false,
  "components": {
    "mesh":      { "castShadow": false, "receiveShadow": true },
    "material":  { "style": "standard", "color": "#a3a7ad", "metalness": 0, "roughness": 0.85,
                   "emissive": "#000000", "emissiveIntensity": 1, "opacity": 1,
                   "mapAssetId": null, "mapRepeat": [1,1],
                   "outline": false, "outlineColor": "#1b1f2a", "outlineWidth": 0.04 },
    "baseplate": { "width": 512, "depth": 512, "thickness": 4, "showGrid": true, "surface": "smooth" },
    "collider":  { "enabled": true, "shape": "auto", "isTrigger": false },
    "rigidBody": { "type": "dynamic", "mass": 1, "friction": 0.6, "restitution": 0.1,
                   "gravityScale": 1, "linearDamping": 0.05, "angularDamping": 0.1 },
    "light":     { "color": "#fff4e0", "intensity": 2.2, "castShadow": true, "range": 0, "angle": 45, "penumbra": 0.3 },
    "camera":    { "fov": 60, "near": 0.1, "far": 2000, "isMain": true },
    "scripts":   [{ "scriptId": "scr_…", "enabled": true }],
    "model":     { "assetId": "ast_…", "animation": null, "loopAnimation": true },
    "spawn":     { "showInGame": false }
  }
}
```

Only the components relevant to an object are present. Notes:

- **Baseplate**: a real box mesh `width × thickness × depth` whose **top surface is
  at local y = 0**; sizes are clamped to 1–8192. The editor grid is controlled by
  `showGrid` and is a separate overlay, not part of the material.
- **Colliders**: a visible mesh only collides if `collider.enabled` is true. Shapes
  are derived from the object type and scale (`auto`) or forced (`box`, `sphere`,
  `capsule`, `cylinder`). Objects with a collider and no `rigidBody` are static,
  or kinematic when they have scripts.
- **Spawn point**: only visible in the editor unless `spawn.showInGame` is true.

## Scripts

```jsonc
{ "id": "scr_…", "name": "Coin", "mode": "blocks",          // or "text"
  "source": "on update { … }",   // Zino Script (generated from blocks in blocks mode)
  "blocks": { "blocks": { "languageVersion": 0, "blocks": [ … ] } },  // Blockly serialisation
  "textBackup": null,            // original text kept after a text → blocks conversion
  "createdAt": "…", "updatedAt": "…" }
```

See [SCRIPTING.md](SCRIPTING.md) for the language and IR.

## Assets

```jsonc
{ "id": "ast_…", "name": "Robot", "kind": "model",   // model texture audio material prefab
  "fileName": "robot.glb", "mimeType": "model/gltf-binary", "size": 123456, "createdAt": "…",
  "model": { "meshes": 3, "materials": 2, "triangles": 5120, "textures": 1,
             "animations": ["Walk"], "boundsMin": [-0.5,0,-0.5], "boundsMax": [0.5,2,0.5] } }
```

Binary data (models, textures, audio) is stored separately from the metadata
(IndexedDB `assets` store / archive `Assets/` folders) and loaded only when used.
Materials and prefabs are data-only assets stored inline.

## Device storage (IndexedDB `zinogame-studio`, version 1)

| Store | Key | Contents |
|---|---|---|
| `projects` | project id | Full project bundle (manifest, scenes, scripts, asset metadata) |
| `summaries` | project id | Name, dates, object count, thumbnail — for the Home screen |
| `assets` | `projectId/assetId` | Binary asset data (`ArrayBuffer`) |
| `backups` | auto | Rolling snapshots (10 per project): on open and every 5 minutes of editing |
| `drafts` | project id | Recovery copy written while autosave is off |

The app requests persistent storage (`navigator.storage.persist()`) so the
browser does not evict projects under storage pressure. Exporting projects
regularly is still recommended.

## Validation, repair and recovery

`validateProjectBundle` (src/engine/project/validation.ts) runs on every load
and import:

- **Hard errors** (project not opened): not JSON/object, wrong `format`, schema
  version newer than the app, no readable scene.
- **Repaired with warnings** (shown in the Console): invalid/duplicate object ids
  (object removed), unknown types (→ Empty), invalid numbers/colours (→ defaults,
  clamped ranges), missing parents (→ top level), parenting loops (broken), missing
  main scene (→ first scene), invalid scripts/assets (removed).

If a stored project cannot be opened and backups exist, the app offers to
restore the most recent backup. Unsaved changes from a draft can be recovered
from the Home screen.

## Migrations

`src/engine/project/migrations.ts` holds one function per schema step
(`MIGRATIONS[n]` upgrades version n → n+1), applied before validation.
v0 → v1 handles the pre-release preview format (renamed `version` field,
scenes stored as an array, square `baseplate.size`). When changing the format:

1. Increase `PROJECT_SCHEMA_VERSION`.
2. Add `MIGRATIONS[old]` that upgrades raw JSON defensively.
3. Update validation/normalisation and this document.
4. Add a migration test in `src/engine/project/project.test.ts`.
