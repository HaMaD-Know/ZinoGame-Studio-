import { describe, expect, it } from 'vitest';
import { AssetCache } from '../assets/AssetCache';
import { InputState } from '../input/InputState';
import { createExampleProject, createProjectFromTemplate } from '../project/templates';
import type { ProjectBundle } from '../project/types';
import { createSceneObject, defaultRigidBody } from '../scene/factory';
import { addObjects } from '../scene/sceneOps';
import type { SceneData } from '../scene/types';
import { createScriptDoc } from '../scripting/scriptDoc';
import { compileScriptsForRuntime } from './compileScripts';
import { GameRuntime, PLAYER_ID, type RuntimeCallbacks, type ScriptErrorInfo } from './GameRuntime';

async function start(bundle: ProjectBundle, callbacks: RuntimeCallbacks = {}, input = new InputState()) {
  const scene = bundle.scenes[bundle.manifest.mainSceneId] as SceneData;
  return GameRuntime.start({
    scene,
    settings: bundle.manifest.settings,
    assets: bundle.assets,
    scripts: compileScriptsForRuntime(bundle.scripts),
    assetCache: new AssetCache(async () => null),
    input,
    context: null,
    callbacks,
    random: () => 0.5,
  });
}

function run(runtime: GameRuntime, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) runtime.step(1 / 60);
}

describe('Game runtime (headless)', () => {
  it('runs a dynamic cube that falls and lands on the baseplate', async () => {
    const bundle = createProjectFromTemplate({ name: 'Fall', template: 'empty-baseplate' });
    bundle.manifest.settings.player.enabled = false;
    const sceneId = bundle.manifest.mainSceneId;
    const cube = createSceneObject('cube', { transform: { position: [0, 10, 0] } });
    cube.components.rigidBody = defaultRigidBody('dynamic');
    bundle.scenes[sceneId] = addObjects(bundle.scenes[sceneId]!, [cube]);
    const editorSnapshot = JSON.stringify(bundle.scenes[sceneId]);

    const runtime = await start(bundle);
    run(runtime, 3);
    const y = runtime.getWorldPosition(cube.id)![1];
    expect(y).toBeGreaterThan(0.4);
    expect(y).toBeLessThan(0.6);
    runtime.stop();
    expect(runtime.isRunning).toBe(false);
    // Play mode never mutates editor data.
    expect(JSON.stringify(bundle.scenes[sceneId])).toBe(editorSnapshot);
  });

  it('runs scripts: start, update and collision events with score', async () => {
    const bundle = createProjectFromTemplate({ name: 'Scripted', template: 'empty-baseplate' });
    bundle.manifest.settings.player.enabled = false;
    const sceneId = bundle.manifest.mainSceneId;
    const script = createScriptDoc(
      'Rules',
      'text',
      `var hits = 0
on start {
  showMessage("ready")
}
on update {
  move(self, 0, 0, 0)
}
on collision {
  hits += 1
  addScore(10)
  destroy(self)
}
`,
    );
    bundle.scripts[script.id] = script;
    const target = createSceneObject('cube', { name: 'Target', transform: { position: [0, 0.5, 0] } });
    target.components.scripts = [{ scriptId: script.id, enabled: true }];
    const ball = createSceneObject('sphere', { name: 'Ball', transform: { position: [0, 6, 0] } });
    ball.components.rigidBody = defaultRigidBody('dynamic');
    bundle.scenes[sceneId] = addObjects(bundle.scenes[sceneId]!, [target, ball]);

    const messages: string[] = [];
    const scores: number[] = [];
    const runtime = await start(bundle, { onMessage: (m) => messages.push(m), onScore: (s) => scores.push(s) });
    expect(messages).toEqual(['ready']);
    run(runtime, 2);
    expect(scores).toContain(10);
    expect(runtime.isAlive(target.id)).toBe(false);
    runtime.stop();
  });

  it('spawns a player at the spawn point that walks and collects coins', async () => {
    const bundle = createExampleProject('coin-collector');
    const input = new InputState();
    const scores: number[] = [];
    const runtime = await start(bundle, { onScore: (s) => scores.push(s) }, input);
    expect(runtime.hasPlayer).toBe(true);
    run(runtime, 1);
    const landed = runtime.getWorldPosition(PLAYER_ID)!;
    expect(landed[1]).toBeLessThan(1.5);
    // Walk forward for a second.
    input.setJoystick(0, 1);
    run(runtime, 1);
    const walked = runtime.getWorldPosition(PLAYER_ID)!;
    expect(Math.hypot(walked[0] - landed[0], walked[2] - landed[2])).toBeGreaterThan(3);
    input.setJoystick(0, 0);
    // Teleport onto a coin that is still there and check it gets collected.
    const coins = bundle.scenes[bundle.manifest.mainSceneId]!.objects.filter((o) => o.name === 'Coin');
    const coin = coins.find((c) => runtime.isAlive(c.id))!;
    const before = runtime.score;
    (runtime as unknown as { host: { setPosition(id: string, v: number[]): void } }).host.setPosition(PLAYER_ID, [
      coin.transform.position[0],
      1,
      coin.transform.position[2],
    ]);
    run(runtime, 0.5);
    expect(runtime.score).toBe(before + 1);
    expect(scores.at(-1)).toBe(before + 1);
    expect(runtime.isAlive(coin.id)).toBe(false);
    runtime.stop();
  });

  it('reports script errors without crashing the game', async () => {
    const bundle = createProjectFromTemplate({ name: 'Errors', template: 'empty-3d' });
    const bad = createScriptDoc('Broken', 'text', 'on update {\n  let x = 1 / 0\n}\n');
    const syntax = createScriptDoc('Typo', 'text', 'on start {\n  move(self\n}\n');
    bundle.scripts[bad.id] = bad;
    bundle.scripts[syntax.id] = syntax;
    const holder = createSceneObject('empty', { name: 'Holder' });
    holder.components.scripts = [
      { scriptId: bad.id, enabled: true },
      { scriptId: syntax.id, enabled: true },
    ];
    const sceneId = bundle.manifest.mainSceneId;
    bundle.scenes[sceneId] = addObjects(bundle.scenes[sceneId]!, [holder]);
    const errors: ScriptErrorInfo[] = [];
    const runtime = await start(bundle, { onScriptError: (e) => errors.push(e) });
    run(runtime, 0.2);
    expect(runtime.isRunning).toBe(true);
    expect(errors.map((e) => e.scriptName).sort()).toEqual(['Broken', 'Typo']);
    expect(errors.find((e) => e.scriptName === 'Broken')?.line).toBe(2);
    runtime.stop();
  });

  it('dispatches button presses to scripts', async () => {
    const bundle = createProjectFromTemplate({ name: 'Buttons', template: 'empty-3d' });
    const script = createScriptDoc('Jumper', 'text', 'on button("action") {\n  addScore(5)\n}\n');
    bundle.scripts[script.id] = script;
    const holder = createSceneObject('empty');
    holder.components.scripts = [{ scriptId: script.id, enabled: true }];
    const sceneId = bundle.manifest.mainSceneId;
    bundle.scenes[sceneId] = addObjects(bundle.scenes[sceneId]!, [holder]);
    const input = new InputState();
    const runtime = await start(bundle, {}, input);
    input.setVirtualButton('action', true);
    runtime.step(1 / 60);
    input.setVirtualButton('action', false);
    runtime.step(1 / 60);
    expect(runtime.score).toBe(5);
    runtime.stop();
  });
});
