import { createId } from '../core/ids';
import type { Vec3 } from '../core/math';
import {
  createBaseplate,
  createEmptySceneData,
  createSceneObject,
  defaultRigidBody,
} from '../scene/factory';
import type { MaterialComponent, SceneObject } from '../scene/types';
import { createScriptDoc } from '../scripting/scriptDoc';
import {
  defaultProjectSettings,
  PROJECT_FORMAT_ID,
  PROJECT_SCHEMA_VERSION,
  type ProjectBundle,
  type ProjectTemplateId,
  type ScriptDoc,
} from './types';

export interface TemplateInfo {
  id: Exclude<ProjectTemplateId, 'example'>;
  name: string;
  description: string;
  recommended?: boolean;
}

export const PROJECT_TEMPLATES: TemplateInfo[] = [
  {
    id: 'empty-baseplate',
    name: 'Empty Baseplate',
    description: 'A big flat ground, a sun, a camera and a player spawn. The best place to start.',
    recommended: true,
  },
  {
    id: 'empty-3d',
    name: 'Empty 3D Scene',
    description: 'Just a camera and a light. Build everything yourself.',
  },
  {
    id: 'playground',
    name: 'Simple 3D Playground',
    description: 'A baseplate with ramps, bouncy balls, a tower to knock over and a spinning script.',
  },
];

export interface ExampleInfo {
  id: string;
  name: string;
  description: string;
}

export const EXAMPLE_PROJECTS: ExampleInfo[] = [
  {
    id: 'coin-collector',
    name: 'Coin Collector',
    description: 'Run around and collect spinning coins. Shows collisions, score and block scripts.',
  },
  {
    id: 'physics-party',
    name: 'Physics Party',
    description: 'Domino rows, bouncing balls and a launch pad. Shows physics bodies and forces.',
  },
  {
    id: 'toon-garden',
    name: 'Toon Garden',
    description: 'A stylised low-poly scene with toon materials and outlines.',
  },
];

export interface CreateProjectInput {
  name: string;
  description?: string;
  template: Exclude<ProjectTemplateId, 'example'>;
  appVersion?: string;
}

function material(base: MaterialComponent | undefined, patch: Partial<MaterialComponent>): MaterialComponent | undefined {
  return base ? { ...base, ...patch } : base;
}

function withMaterial(obj: SceneObject, patch: Partial<MaterialComponent>): SceneObject {
  obj.components.material = material(obj.components.material, patch);
  return obj;
}

function dynamic(obj: SceneObject, patch: Partial<ReturnType<typeof defaultRigidBody>> = {}): SceneObject {
  obj.components.rigidBody = { ...defaultRigidBody('dynamic'), ...patch };
  return obj;
}

function attach(obj: SceneObject, script: ScriptDoc): SceneObject {
  obj.components.scripts = [...(obj.components.scripts ?? []), { scriptId: script.id, enabled: true }];
  return obj;
}

function at(obj: SceneObject, position: Vec3, scale?: Vec3, rotation?: Vec3): SceneObject {
  obj.transform.position = [...position];
  if (scale) obj.transform.scale = [...scale];
  if (rotation) obj.transform.rotation = [...rotation];
  return obj;
}

/** The objects every baseplate project starts with. */
export function baseplateStarterObjects(): SceneObject[] {
  const camera = createSceneObject('camera', { name: 'Camera' });
  if (camera.components.camera) camera.components.camera.isMain = true;
  return [
    createBaseplate(),
    camera,
    createSceneObject('directionalLight', { name: 'Sun' }),
    createSceneObject('spawnPoint', { name: 'Player Spawn' }),
  ];
}

function baseBundle(
  input: Omit<CreateProjectInput, 'template'> & { template: ProjectTemplateId },
  objects: SceneObject[],
): ProjectBundle {
  const now = new Date().toISOString();
  const scene = createEmptySceneData('Main Scene');
  scene.objects = objects;
  return {
    manifest: {
      format: PROJECT_FORMAT_ID,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: createId('prj'),
      name: input.name.trim(),
      description: (input.description ?? '').trim(),
      template: input.template,
      createdAt: now,
      updatedAt: now,
      appVersion: input.appVersion ?? '0.0.0',
      mainSceneId: scene.id,
      sceneIds: [scene.id],
      settings: defaultProjectSettings(input.template),
    },
    scenes: { [scene.id]: scene },
    scripts: {},
    assets: {},
  };
}

const SPINNER_SCRIPT = `// Spin slowly forever
on update {
  rotate(self, 0, 60 * dt, 0)
}
`;

export function createProjectFromTemplate(input: CreateProjectInput): ProjectBundle {
  switch (input.template) {
    case 'empty-baseplate':
      return baseBundle(input, baseplateStarterObjects());
    case 'empty-3d': {
      const camera = createSceneObject('camera', { name: 'Camera' });
      if (camera.components.camera) camera.components.camera.isMain = true;
      return baseBundle(input, [camera, createSceneObject('directionalLight', { name: 'Sun' })]);
    }
    case 'playground': {
      const spinner = createScriptDoc('Spinner', 'blocks', SPINNER_SCRIPT);
      const objects: SceneObject[] = [...baseplateStarterObjects()];
      objects.push(
        withMaterial(at(createSceneObject('cube', { name: 'Ramp' }), [10, 1.2, -6], [8, 0.5, 4], [0, 0, 18]), { color: '#ff9f43' }),
      );
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3 - (row % 2); col++) {
          objects.push(
            dynamic(
              withMaterial(at(createSceneObject('cube', { name: 'Tower Block' }), [-10 + col * 1.05 + (row % 2) * 0.5, 0.5 + row, -8]), {
                color: row % 2 ? '#4f8cff' : '#7bd389',
              }),
            ),
          );
        }
      }
      for (let i = 0; i < 3; i++) {
        objects.push(
          dynamic(withMaterial(at(createSceneObject('sphere', { name: 'Bouncy Ball' }), [-3 + i * 3, 4 + i * 2, -4]), { color: '#ff5d8f' }), {
            restitution: 0.85,
          }),
        );
      }
      objects.push(
        attach(
          withMaterial(at(createSceneObject('cube', { name: 'Spinner' }), [0, 2, -12], [2, 2, 2]), { color: '#b57bff', metalness: 0.3, roughness: 0.3 }),
          spinner,
        ),
      );
      objects.push(at(createSceneObject('pointLight', { name: 'Glow Light' }), [0, 5, -12]));
      const bundle = baseBundle(input, objects);
      bundle.scripts[spinner.id] = spinner;
      return bundle;
    }
  }
}

const COIN_SCRIPT = `// Coins spin, and disappear when the player touches them
on update {
  rotate(self, 0, 120 * dt, 0)
}

on collision {
  addScore(1)
  playSound("coin")
  destroy(self)
}
`;

const GAME_RULES_SCRIPT = `var goal = 5

on start {
  showMessage("Collect all the coins!")
}

on update {
  if (getScore() >= goal) {
    showMessage("You collected every coin!")
    setScore(0)
  }
}
`;

const LAUNCH_SCRIPT = `// Bounce anything that lands on the pad into the air
on collision {
  applyForce(other, 0, 12, 0)
  playSound("jump")
}
`;

export function createExampleProject(exampleId: string, appVersion = '0.0.0'): ProjectBundle {
  const info = EXAMPLE_PROJECTS.find((e) => e.id === exampleId);
  if (!info) throw new Error(`Unknown example: ${exampleId}`);
  const input = { name: info.name, description: info.description, template: 'example' as const, appVersion };

  switch (exampleId) {
    case 'coin-collector': {
      const coinScript = createScriptDoc('Coin', 'blocks', COIN_SCRIPT);
      const rules = createScriptDoc('Game Rules', 'blocks', GAME_RULES_SCRIPT);
      const objects = baseplateStarterObjects();
      const positions: Vec3[] = [[6, 1, 0], [-6, 1, 4], [0, 1, -8], [10, 1, 10], [-10, 1, -10]];
      for (const p of positions) {
        const coin = at(createSceneObject('cylinder', { name: 'Coin' }), p, [1, 0.15, 1], [90, 0, 0]);
        withMaterial(coin, { color: '#ffcf3d', metalness: 0.8, roughness: 0.25, emissive: '#5a3d00' });
        coin.components.collider = { enabled: true, shape: 'auto', isTrigger: true };
        attach(coin, coinScript);
        objects.push(coin);
      }
      const manager = attach(createSceneObject('empty', { name: 'Game Manager' }), rules);
      objects.push(manager);
      const bundle = baseBundle(input, objects);
      bundle.scripts[coinScript.id] = coinScript;
      bundle.scripts[rules.id] = rules;
      return bundle;
    }
    case 'physics-party': {
      const launch = createScriptDoc('Launch Pad', 'blocks', LAUNCH_SCRIPT);
      const objects = baseplateStarterObjects();
      for (let i = 0; i < 12; i++) {
        objects.push(
          dynamic(withMaterial(at(createSceneObject('cube', { name: 'Domino' }), [-8 + i * 1.4, 1.5, -6], [0.3, 3, 1.5]), { color: i % 2 ? '#ff5d8f' : '#4f8cff' })),
        );
      }
      for (let i = 0; i < 5; i++) {
        objects.push(
          dynamic(withMaterial(at(createSceneObject('sphere', { name: 'Ball' }), [-4 + i * 2, 6 + i, 4]), { color: '#7bd389' }), { restitution: 0.9 }),
        );
      }
      const pad = attach(withMaterial(at(createSceneObject('cylinder', { name: 'Launch Pad' }), [8, 0.15, 6], [4, 0.3, 4]), { color: '#ffcf3d', emissive: '#4a3300' }), launch);
      objects.push(pad);
      const bundle = baseBundle(input, objects);
      bundle.scripts[launch.id] = launch;
      return bundle;
    }
    case 'toon-garden': {
      const objects = baseplateStarterObjects();
      const bp = objects[0] as SceneObject;
      if (bp.components.baseplate) bp.components.baseplate.surface = 'grass';
      withMaterial(bp, { color: '#7cc46a', roughness: 1 });
      const toon = { style: 'toon' as const, outline: true };
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * 9;
        const z = Math.sin(angle) * 9;
        objects.push(withMaterial(at(createSceneObject('cylinder', { name: 'Trunk' }), [x, 1, z], [0.5, 2, 0.5]), { ...toon, color: '#8b5a2b' }));
        objects.push(withMaterial(at(createSceneObject('cone', { name: 'Tree Top' }), [x, 3.2, z], [2.4, 3, 2.4]), { ...toon, color: '#3fae6a' }));
      }
      objects.push(withMaterial(at(createSceneObject('sphere', { name: 'Boulder' }), [0, 0.8, 0], [2, 1.6, 2]), { style: 'flat', color: '#9aa3b5' }));
      const spinner = createScriptDoc('Spinner', 'blocks', SPINNER_SCRIPT);
      objects.push(attach(
        withMaterial(at(createSceneObject('cone', { name: 'Crystal' }), [0, 3, 0], [0.8, 1.6, 0.8], [180, 0, 0]), { ...toon, color: '#7fd6ff', emissive: '#1b5a7a' }),
        spinner,
      ));
      const bundle = baseBundle(input, objects);
      bundle.scripts[spinner.id] = spinner;
      bundle.manifest.settings.renderStyle = 'stylized';
      return bundle;
    }
  }
  throw new Error(`Unknown example: ${exampleId}`);
}
