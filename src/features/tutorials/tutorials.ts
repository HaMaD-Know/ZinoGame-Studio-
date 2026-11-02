import type { EditorState } from '../../editor/EditorSession';
import type { SceneData } from '../../engine/scene/types';

/**
 * Beginner tutorials. Each step has a check that is evaluated against the
 * live editor state, so steps tick themselves off as the user works.
 */

export type TutorialId = 'first-scene' | 'make-it-spin' | 'physics-fun';

export interface TutorialContext {
  state: EditorState;
  scene: SceneData;
  /** Snapshot of the scene when the tutorial started. */
  startScene: SceneData;
  hasPlayed: boolean;
}

export interface TutorialStep {
  text: string;
  hint?: string;
  done: (ctx: TutorialContext) => boolean;
}

export interface Tutorial {
  id: TutorialId;
  title: string;
  summary: string;
  minutes: number;
  steps: TutorialStep[];
}

const newObjects = (ctx: TutorialContext) => {
  const before = new Set(ctx.startScene.objects.map((o) => o.id));
  return ctx.scene.objects.filter((o) => !before.has(o.id));
};

export const TUTORIALS: Tutorial[] = [
  {
    id: 'first-scene',
    title: 'Your first scene',
    summary: 'Add a block, move it around, give it a colour and play your world.',
    minutes: 3,
    steps: [
      {
        text: 'Tap "Add" in the toolbar and add a Cube.',
        done: (c) => newObjects(c).some((o) => o.type === 'cube'),
      },
      {
        text: 'Drag the coloured arrows to move the cube somewhere new.',
        hint: 'Arrows move along one direction. You can also type numbers in the Inspector.',
        done: (c) =>
          newObjects(c).some(
            (o) => o.type === 'cube' && (Math.abs(o.transform.position[0]) > 0.2 || Math.abs(o.transform.position[2]) > 0.2 || o.transform.position[1] > 0.7),
          ),
      },
      {
        text: 'Pick a new colour for it in the Inspector under Appearance.',
        done: (c) => newObjects(c).some((o) => o.type === 'cube' && o.components.material?.color !== '#4f8cff'),
      },
      {
        text: 'Press the green Play button to walk around your world.',
        hint: 'Use WASD or the on-screen joystick. Press Stop to come back.',
        done: (c) => c.hasPlayed,
      },
    ],
  },
  {
    id: 'make-it-spin',
    title: 'Make it spin',
    summary: 'Write your first block script and attach it to an object.',
    minutes: 4,
    steps: [
      {
        text: 'Add a Cube to the scene.',
        done: (c) => c.scene.objects.some((o) => o.type === 'cube'),
      },
      {
        text: 'With the cube selected, tap "Add script" in the Inspector.',
        done: (c) => c.scene.objects.some((o) => (o.components.scripts?.length ?? 0) > 0),
      },
      {
        text: 'In the script, drag "every frame" from Events, then "rotate" from Motion inside it.',
        hint: 'Put "frame time" (Input) multiplied by a number in the Y slot for smooth spinning.',
        done: (c) =>
          Object.values(c.state.project.scripts).some((s) => /on update[\s\S]*rotate\(/.test(s.source)),
      },
      {
        text: 'Press Play and watch it spin!',
        done: (c) => c.hasPlayed,
      },
    ],
  },
  {
    id: 'physics-fun',
    title: 'Physics fun',
    summary: 'Drop balls from the sky and watch them bounce.',
    minutes: 3,
    steps: [
      {
        text: 'Add a Sphere.',
        done: (c) => newObjects(c).some((o) => o.type === 'sphere'),
      },
      {
        text: 'Move it up high (Position Y above 5).',
        done: (c) => newObjects(c).some((o) => o.type === 'sphere' && o.transform.position[1] > 5),
      },
      {
        text: 'In the Inspector, turn on "Falls and bounces" under Physics.',
        done: (c) => newObjects(c).some((o) => o.type === 'sphere' && o.components.rigidBody?.type === 'dynamic'),
      },
      {
        text: 'Make it bouncy: raise Bounciness above 0.5.',
        done: (c) => newObjects(c).some((o) => o.type === 'sphere' && (o.components.rigidBody?.restitution ?? 0) > 0.5),
      },
      {
        text: 'Press Play and watch it fall and bounce.',
        done: (c) => c.hasPlayed,
      },
    ],
  },
];
