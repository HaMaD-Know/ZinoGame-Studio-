import {
  Atom,
  Camera,
  CodeXml,
  CopyPlus,
  Group,
  Lightbulb,
  Link2Off,
  MapPin,
  Mountain,
  Move3d,
  Package,
  Palette,
  Plus,
  RotateCcw,
  SquareMousePointer,
  Trash,
} from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/AppController';
import { usePreferences } from '../../app/preferences';
import { useEditor } from '../../app/services';
import { Menu, MenuItem } from '../../components/feedback';
import { ColorField, CommitTextField, NumberField, SelectField, SliderField, Vec3Field } from '../../components/fields';
import { ObjectIcon } from '../../components/icons';
import { Button, EmptyState, IconButton, Section, Segmented, Switch } from '../../components/ui';
import type { EditorSession } from '../../editor/EditorSession';
import type { Vec3 } from '../../engine/core/math';
import {
  resetBaseplate,
  resizeBaseplate,
  setBaseplateCollision,
  setBaseplateColor,
  setBaseplateGrid,
  setBaseplateSurface,
  updateBaseplate,
} from '../../engine/scene/baseplate';
import {
  BASEPLATE_SIZE_PRESETS,
  BASEPLATE_SURFACES,
  defaultCollider,
  defaultMaterial,
  defaultRigidBody,
  OBJECT_TYPE_LABELS,
} from '../../engine/scene/factory';
import type {
  BaseplateMaterialPreset,
  BodyType,
  ColliderShape,
  MaterialComponent,
  MaterialStyle,
  RigidBodyComponent,
  SceneObject,
} from '../../engine/scene/types';
import { deleteSelection, type ActionDeps } from '../scene-editor/editorActions';
import { EnvironmentInspector } from './EnvironmentInspector';

export function InspectorPanel({ session, deps }: { session: EditorSession; deps: ActionDeps }) {
  const selection = useEditor(session, (s) => s.selection);
  const envSelected = useEditor(session, (s) => s.environmentSelected);
  const scene = useEditor(session, (s) => s.project.scenes[s.sceneId]);
  const playing = useEditor(session, (s) => s.playState !== 'edit');
  const objects = selection.map((id) => scene?.objects.find((o) => o.id === id)).filter((o): o is SceneObject => !!o);

  let body;
  if (envSelected) body = <EnvironmentInspector session={session} />;
  else if (objects.length === 0) {
    body = (
      <EmptyState icon={SquareMousePointer} title="Nothing selected">
        Tap an object in the 3D view or in the Objects list to change it. Tap “Environment &amp; Sky” to change the sky and the player.
      </EmptyState>
    );
  } else if (objects.length > 1) {
    body = (
      <div className="inspector-body" style={{ paddingTop: 16 }}>
        <p>
          <strong>{objects.length} objects selected</strong>
        </p>
        <p className="small muted">Move them together with the Move tool, or use these actions:</p>
        <div className="row row-wrap">
          <Button icon={CopyPlus} onClick={() => session.duplicateObjects()}>
            Duplicate
          </Button>
          <Button icon={Group} onClick={() => session.groupSelection()}>
            Group
          </Button>
          <Button icon={Trash} variant="danger" onClick={() => void deleteSelection(deps)}>
            Delete
          </Button>
        </div>
      </div>
    );
  } else {
    body = <ObjectInspector key={objects[0]!.id} session={session} obj={objects[0]!} deps={deps} />;
  }

  return (
    <>
      <div className="panel-header">
        <h2>Inspector</h2>
      </div>
      <div className="panel-scroll" aria-disabled={playing} style={playing ? { pointerEvents: 'none', opacity: 0.6 } : undefined}>
        {body}
      </div>
    </>
  );
}

function ObjectInspector({ session, obj, deps }: { session: EditorSession; obj: SceneObject; deps: ActionDeps }) {
  const prefs = usePreferences();
  const advanced = prefs.editorMode === 'advanced';
  const c = obj.components;
  return (
    <div data-testid="object-inspector">
      <div className="inspector-title">
        <div className="type-icon">
          <ObjectIcon type={obj.type} size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }} className="prop-stack">
          <CommitTextField value={obj.name} ariaLabel="Object name" onCommit={(v) => session.rename(obj.id, v)} />
          <span className="small faint">{OBJECT_TYPE_LABELS[obj.type]}</span>
        </div>
        <Switch label="Visible" hideLabel checked={obj.visible} onChange={(v) => session.setVisible(obj.id, v)} />
      </div>
      <TransformSection session={session} obj={obj} />
      {c.baseplate && <BaseplateSection session={session} obj={obj} />}
      {c.material && obj.type !== 'baseplate' && <AppearanceSection session={session} obj={obj} advanced={advanced} />}
      {c.light && <LightSection session={session} obj={obj} advanced={advanced} />}
      {c.camera && <CameraSection session={session} obj={obj} />}
      {c.model && <ModelSection session={session} obj={obj} />}
      {c.spawn && <SpawnSection session={session} obj={obj} />}
      {hasPhysicsShape(obj) && obj.type !== 'baseplate' && <PhysicsSection session={session} obj={obj} advanced={advanced} />}
      <ScriptsSection session={session} obj={obj} />
      {advanced && (
        <Section title="Object" icon={SquareMousePointer} defaultOpen={false}>
          <Switch label="Locked (can’t be picked in the 3D view)" checked={obj.locked} onChange={(v) => session.setLocked(obj.id, v)} />
          <p className="small faint mono">id: {obj.id}</p>
        </Section>
      )}
      <div className="inspector-body" style={{ paddingTop: 14 }}>
        <Button variant="danger" icon={Trash} onClick={() => void deleteSelection(deps, [obj.id])}>
          Delete {obj.name}
        </Button>
      </div>
    </div>
  );
}

function hasPhysicsShape(obj: SceneObject): boolean {
  return ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'model'].includes(obj.type);
}

function TransformSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const [uniform, setUniform] = useState(() => {
    const s = obj.transform.scale;
    return s[0] === s[1] && s[1] === s[2];
  });
  const key = `${obj.id}:transform`;
  const isLight = obj.type === 'directionalLight';
  return (
    <Section title="Transform" icon={Move3d}>
      {!isLight && (
        <div className="prop-stack">
          <span className="field-label">Position</span>
          <Vec3Field ariaLabel="Position" value={obj.transform.position} step={0.1} onChange={(v) => session.setTransform(obj.id, { position: v }, `${key}:p`)} />
        </div>
      )}
      <div className="prop-stack">
        <span className="field-label">{isLight ? 'Direction (rotation)' : 'Rotation (degrees)'}</span>
        <Vec3Field ariaLabel="Rotation" value={obj.transform.rotation} step={1} precision={2} onChange={(v) => session.setTransform(obj.id, { rotation: v }, `${key}:r`)} />
      </div>
      {!isLight && obj.type !== 'spawnPoint' && (
        <div className="prop-stack">
          <div className="row">
            <span className="field-label" style={{ flex: 1 }}>
              Size (scale)
            </span>
            <Switch label="Keep proportions" checked={uniform} onChange={setUniform} />
          </div>
          <Vec3Field
            ariaLabel="Scale"
            value={obj.transform.scale}
            step={0.05}
            onChange={(v, _scrubbing) => {
              let next: Vec3 = v;
              if (uniform) {
                const old = obj.transform.scale;
                const changed = v.findIndex((n, i) => n !== old[i]);
                if (changed >= 0) {
                  const ratio = old[changed] === 0 ? 1 : (v[changed] as number) / (old[changed] as number);
                  next = [old[0] * ratio, old[1] * ratio, old[2] * ratio].map((n) => Math.round(n * 1000) / 1000) as Vec3;
                  if (old[changed] === 0) next = [v[changed] as number, v[changed] as number, v[changed] as number];
                }
              }
              session.setTransform(obj.id, { scale: next }, `${key}:s`);
            }}
          />
        </div>
      )}
      <Button
        size="sm"
        icon={RotateCcw}
        onClick={() =>
          session.setTransform(obj.id, {
            position: obj.type === 'baseplate' ? [0, 0, 0] : obj.transform.position,
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          })
        }
      >
        Reset rotation &amp; size
      </Button>
    </Section>
  );
}

function BaseplateSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const bp = obj.components.baseplate!;
  const mat = obj.components.material ?? defaultMaterial();
  const change = (label: string, fn: Parameters<EditorSession['applySceneChange']>[1], mergeKey?: string) =>
    session.applySceneChange(label, fn, { mergeKey });
  const isPreset = (n: number) => bp.width === n && bp.depth === n;
  return (
    <Section title="Baseplate" icon={Mountain}>
      <div className="prop-stack">
        <span className="field-label">Size</span>
        <div className="preset-grid" role="group" aria-label="Baseplate size presets">
          {BASEPLATE_SIZE_PRESETS.map((n) => (
            <button key={n} type="button" aria-pressed={isPreset(n)} onClick={() => change('Resize baseplate', (s) => resizeBaseplate(s, obj.id, n, n))}>
              {n}
            </button>
          ))}
        </div>
        <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <NumberField label="W" color="var(--axis-x)" ariaLabel="Baseplate width" value={bp.width} step={1} min={1} max={8192} precision={2}
            onChange={(v) => change('Resize baseplate', (s) => resizeBaseplate(s, obj.id, v, bp.depth), `${obj.id}:bpw`)} />
          <NumberField label="D" color="var(--axis-z)" ariaLabel="Baseplate depth" value={bp.depth} step={1} min={1} max={8192} precision={2}
            onChange={(v) => change('Resize baseplate', (s) => resizeBaseplate(s, obj.id, bp.width, v), `${obj.id}:bpd`)} />
        </div>
      </div>
      <div className="prop-row">
        <label>Thickness</label>
        <NumberField ariaLabel="Baseplate thickness" value={bp.thickness} step={0.5} min={0.1} max={100} precision={2}
          onChange={(v) => change('Change thickness', (s) => updateBaseplate(s, obj.id, { thickness: v }), `${obj.id}:bpt`)} />
      </div>
      <div className="prop-row">
        <label>Surface</label>
        <SelectField<BaseplateMaterialPreset>
          ariaLabel="Baseplate surface"
          value={bp.surface}
          options={(Object.keys(BASEPLATE_SURFACES) as BaseplateMaterialPreset[]).map((k) => ({ value: k, label: BASEPLATE_SURFACES[k].label }))}
          onChange={(v) => change('Change surface', (s) => setBaseplateSurface(s, obj.id, v))}
        />
      </div>
      <div className="prop-stack">
        <span className="field-label">Colour</span>
        <ColorField ariaLabel="Baseplate colour" value={mat.color} onChange={(color) => change('Change colour', (s) => setBaseplateColor(s, obj.id, color), `${obj.id}:bpc`)} />
      </div>
      <Switch label="Show editor grid" checked={bp.showGrid} onChange={(v) => change(v ? 'Show grid' : 'Hide grid', (s) => setBaseplateGrid(s, obj.id, v))} />
      <Switch
        label="Solid (players and objects stand on it)"
        checked={obj.components.collider?.enabled ?? false}
        onChange={(v) => change(v ? 'Enable collision' : 'Disable collision', (s) => setBaseplateCollision(s, obj.id, v))}
      />
      <Button size="sm" icon={RotateCcw} onClick={() => change('Reset baseplate', (s) => resetBaseplate(s, obj.id))}>
        Reset baseplate
      </Button>
    </Section>
  );
}

const STYLE_OPTIONS: { value: MaterialStyle; label: string }[] = [
  { value: 'standard', label: 'Realistic' },
  { value: 'toon', label: 'Toon' },
  { value: 'flat', label: 'Low-poly' },
  { value: 'unlit', label: 'Glow' },
];

function AppearanceSection({ session, obj, advanced }: { session: EditorSession; obj: SceneObject; advanced: boolean }) {
  const app = useApp();
  const m = obj.components.material ?? defaultMaterial();
  const assets = useEditor(session, (s) => s.project.assets);
  const textures = Object.values(assets).filter((a) => a.kind === 'texture');
  const materials = Object.values(assets).filter((a) => a.kind === 'material');
  const [more, setMore] = useState(advanced);
  const update = (label: string, patch: Partial<MaterialComponent>, mergeKey?: string) =>
    session.updateComponents(obj.id, label, { material: { ...m, ...patch } }, mergeKey ? `${obj.id}:${mergeKey}` : undefined);
  return (
    <Section title="Appearance" icon={Palette}>
      <div className="prop-stack">
        <span className="field-label">Style</span>
        <Segmented label="Material style" value={m.style} options={STYLE_OPTIONS} onChange={(v) => update('Change style', { style: v })} />
      </div>
      <div className="prop-stack">
        <span className="field-label">Colour</span>
        <ColorField ariaLabel="Colour" value={m.color} onChange={(color) => update('Change colour', { color }, 'color')} />
      </div>
      {materials.length > 0 && (
        <div className="prop-row">
          <label>Material</label>
          <SelectField
            ariaLabel="Apply saved material"
            value=""
            options={[{ value: '', label: 'Apply a saved material…' }, ...materials.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={(id) => {
              const asset = assets[id];
              if (asset?.material) session.updateComponents(obj.id, `Apply ${asset.name}`, { material: { ...asset.material } });
            }}
          />
        </div>
      )}
      <div className="prop-row">
        <label>Texture</label>
        <SelectField
          ariaLabel="Texture"
          value={m.mapAssetId ?? ''}
          options={[{ value: '', label: textures.length ? 'None' : 'None (import images in Assets)' }, ...textures.map((t) => ({ value: t.id, label: t.name }))]}
          onChange={(v) => update(v ? 'Apply texture' : 'Remove texture', { mapAssetId: v || null })}
        />
      </div>
      {m.mapAssetId && (
        <div className="prop-row">
          <label>Tiling</label>
          <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <NumberField label="U" ariaLabel="Texture tiling U" value={m.mapRepeat[0]} step={0.25} min={0.01} onChange={(v) => update('Change tiling', { mapRepeat: [v, m.mapRepeat[1]] }, 'tile')} />
            <NumberField label="V" ariaLabel="Texture tiling V" value={m.mapRepeat[1]} step={0.25} min={0.01} onChange={(v) => update('Change tiling', { mapRepeat: [m.mapRepeat[0], v] }, 'tile')} />
          </div>
        </div>
      )}
      {m.style === 'toon' && (
        <>
          <Switch label="Outline" checked={m.outline} onChange={(v) => update(v ? 'Add outline' : 'Remove outline', { outline: v })} />
          {m.outline && (
            <>
              <div className="prop-stack">
                <span className="field-label">Outline colour</span>
                <ColorField ariaLabel="Outline colour" swatches={false} value={m.outlineColor} onChange={(c) => update('Outline colour', { outlineColor: c }, 'ocol')} />
              </div>
              <div className="prop-stack">
                <span className="field-label">Outline width</span>
                <SliderField ariaLabel="Outline width" min={0.005} max={0.2} step={0.005} value={m.outlineWidth} onChange={(v) => update('Outline width', { outlineWidth: v }, 'ow')} />
              </div>
            </>
          )}
        </>
      )}
      {!more ? (
        <Button size="sm" variant="ghost" onClick={() => setMore(true)}>
          More options…
        </Button>
      ) : (
        <>
          {m.style === 'standard' && (
            <>
              <div className="prop-stack">
                <span className="field-label">Metal</span>
                <SliderField ariaLabel="Metalness" min={0} max={1} step={0.01} value={m.metalness} onChange={(v) => update('Change metalness', { metalness: v }, 'metal')} />
              </div>
              <div className="prop-stack">
                <span className="field-label">Roughness</span>
                <SliderField ariaLabel="Roughness" min={0} max={1} step={0.01} value={m.roughness} onChange={(v) => update('Change roughness', { roughness: v }, 'rough')} />
              </div>
            </>
          )}
          <div className="prop-stack">
            <span className="field-label">Opacity</span>
            <SliderField ariaLabel="Opacity" min={0} max={1} step={0.01} value={m.opacity} onChange={(v) => update('Change opacity', { opacity: v }, 'opacity')} />
          </div>
          {m.style !== 'unlit' && (
            <>
              <div className="prop-stack">
                <span className="field-label">Glow colour</span>
                <ColorField ariaLabel="Glow colour" swatches={false} value={m.emissive} onChange={(c) => update('Change glow', { emissive: c }, 'emissive')} />
              </div>
              {advanced && (
                <div className="prop-stack">
                  <span className="field-label">Glow strength</span>
                  <SliderField ariaLabel="Glow strength" min={0} max={10} step={0.1} value={m.emissiveIntensity} onChange={(v) => update('Glow strength', { emissiveIntensity: v }, 'ei')} />
                </div>
              )}
            </>
          )}
          {obj.components.mesh && (
            <>
              <Switch label="Casts shadows" checked={obj.components.mesh.castShadow} onChange={(v) => session.updateComponents(obj.id, 'Shadows', { mesh: { ...obj.components.mesh!, castShadow: v } })} />
              {advanced && (
                <Switch label="Receives shadows" checked={obj.components.mesh.receiveShadow} onChange={(v) => session.updateComponents(obj.id, 'Shadows', { mesh: { ...obj.components.mesh!, receiveShadow: v } })} />
              )}
            </>
          )}
        </>
      )}
      {textures.length === 0 && (
        <Button size="sm" variant="ghost" onClick={() => app.navigate('assets')}>
          Import textures…
        </Button>
      )}
    </Section>
  );
}

function LightSection({ session, obj, advanced }: { session: EditorSession; obj: SceneObject; advanced: boolean }) {
  const l = obj.components.light!;
  const update = (patch: Partial<typeof l>, key: string) =>
    session.updateComponents(obj.id, 'Change light', { light: { ...l, ...patch } }, `${obj.id}:light:${key}`);
  const maxIntensity = obj.type === 'directionalLight' ? 10 : 500;
  return (
    <Section title="Light" icon={Lightbulb}>
      <div className="prop-stack">
        <span className="field-label">Colour</span>
        <ColorField ariaLabel="Light colour" value={l.color} onChange={(c) => update({ color: c }, 'color')} />
      </div>
      <div className="prop-stack">
        <span className="field-label">Brightness</span>
        <SliderField ariaLabel="Brightness" min={0} max={maxIntensity} step={obj.type === 'directionalLight' ? 0.05 : 1} value={l.intensity} onChange={(v) => update({ intensity: v }, 'i')} />
      </div>
      {obj.type !== 'directionalLight' && (
        <div className="prop-stack">
          <span className="field-label">Range</span>
          <SliderField ariaLabel="Range" min={0} max={200} step={1} value={l.range} onChange={(v) => update({ range: v }, 'range')} />
        </div>
      )}
      {obj.type === 'spotLight' && (
        <>
          <div className="prop-stack">
            <span className="field-label">Cone angle</span>
            <SliderField ariaLabel="Cone angle" min={1} max={89} step={1} value={l.angle} onChange={(v) => update({ angle: v }, 'angle')} />
          </div>
          {advanced && (
            <div className="prop-stack">
              <span className="field-label">Soft edge</span>
              <SliderField ariaLabel="Soft edge" min={0} max={1} step={0.01} value={l.penumbra} onChange={(v) => update({ penumbra: v }, 'pen')} />
            </div>
          )}
        </>
      )}
      <Switch label="Casts shadows" checked={l.castShadow} onChange={(v) => update({ castShadow: v }, 'shadow')} />
    </Section>
  );
}

function CameraSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const cam = obj.components.camera!;
  return (
    <Section title="Camera" icon={Camera}>
      <div className="prop-stack">
        <span className="field-label">Field of view</span>
        <SliderField ariaLabel="Field of view" min={20} max={120} step={1} value={cam.fov}
          onChange={(v) => session.updateComponents(obj.id, 'Field of view', { camera: { ...cam, fov: v } }, `${obj.id}:fov`)} />
      </div>
      <Switch
        label="Main camera (used when there is no player)"
        checked={cam.isMain}
        onChange={(v) =>
          session.applySceneChange('Set main camera', (s) => ({
            ...s,
            objects: s.objects.map((o) =>
              o.components.camera ? { ...o, components: { ...o.components, camera: { ...o.components.camera, isMain: o.id === obj.id ? v : v ? false : o.components.camera.isMain } } } : o,
            ),
          }))
        }
      />
    </Section>
  );
}

function ModelSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const model = obj.components.model!;
  const asset = useEditor(session, (s) => s.project.assets[model.assetId]);
  const animations = asset?.model?.animations ?? [];
  return (
    <Section title="Model" icon={Package}>
      {asset ? (
        <p className="small">
          <strong>{asset.name}</strong>
          <span className="muted"> · {asset.model?.triangles.toLocaleString('en-US') ?? '?'} triangles</span>
        </p>
      ) : (
        <div className="banner banner-warning small">The model file for this object is missing. Re-import it in Assets.</div>
      )}
      {animations.length > 0 && (
        <>
          <div className="prop-row">
            <label>Animation</label>
            <SelectField
              ariaLabel="Animation to play"
              value={model.animation ?? ''}
              options={[{ value: '', label: 'None' }, ...animations.map((a) => ({ value: a, label: a }))]}
              onChange={(v) => session.updateComponents(obj.id, 'Change animation', { model: { ...model, animation: v || null } })}
            />
          </div>
          <Switch label="Loop animation" checked={model.loopAnimation} onChange={(v) => session.updateComponents(obj.id, 'Loop animation', { model: { ...model, loopAnimation: v } })} />
          <p className="small faint">Animations play in Play mode.</p>
        </>
      )}
    </Section>
  );
}

function SpawnSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const spawn = obj.components.spawn!;
  return (
    <Section title="Player spawn" icon={MapPin}>
      <p className="small muted">The player appears here when you press Play. The marker is only visible while editing.</p>
      <Switch label="Show marker in the game" checked={spawn.showInGame} onChange={(v) => session.updateComponents(obj.id, 'Spawn marker', { spawn: { showInGame: v } })} />
    </Section>
  );
}

function PhysicsSection({ session, obj, advanced }: { session: EditorSession; obj: SceneObject; advanced: boolean }) {
  const collider = obj.components.collider;
  const rb = obj.components.rigidBody;
  const solid = collider?.enabled ?? false;
  const dynamic = rb?.type === 'dynamic';
  const updateRb = (patch: Partial<RigidBodyComponent>, key: string) =>
    session.updateComponents(obj.id, 'Change physics', { rigidBody: { ...(rb ?? defaultRigidBody()), ...patch } }, `${obj.id}:rb:${key}`);
  return (
    <Section title="Physics" icon={Atom} defaultOpen={solid || !!rb}>
      <Switch
        label="Solid (things bump into it)"
        checked={solid}
        onChange={(v) => session.updateComponents(obj.id, v ? 'Make solid' : 'Make non-solid', { collider: { ...(collider ?? defaultCollider()), enabled: v } })}
      />
      <Switch
        label="Falls and bounces (physics body)"
        checked={dynamic}
        onChange={(v) => {
          if (v) {
            session.updateComponents(obj.id, 'Add physics body', {
              rigidBody: { ...(rb ?? defaultRigidBody()), type: 'dynamic' },
              collider: { ...(collider ?? defaultCollider()), enabled: true },
            });
          } else {
            session.removeComponent(obj.id, 'rigidBody', 'Remove physics body');
          }
        }}
      />
      {rb && (
        <>
          {advanced && (
            <div className="prop-row">
              <label>Body type</label>
              <SelectField<BodyType>
                ariaLabel="Body type"
                value={rb.type}
                options={[
                  { value: 'dynamic', label: 'Dynamic (falls)' },
                  { value: 'kinematic', label: 'Kinematic (moved by scripts)' },
                  { value: 'static', label: 'Static (never moves)' },
                ]}
                onChange={(v) => updateRb({ type: v }, 'type')}
              />
            </div>
          )}
          <div className="prop-stack">
            <span className="field-label">Bounciness</span>
            <SliderField ariaLabel="Bounciness" min={0} max={1.2} step={0.01} value={rb.restitution} onChange={(v) => updateRb({ restitution: v }, 'rest')} />
          </div>
          <div className="prop-stack">
            <span className="field-label">Friction</span>
            <SliderField ariaLabel="Friction" min={0} max={2} step={0.01} value={rb.friction} onChange={(v) => updateRb({ friction: v }, 'fric')} />
          </div>
          <div className="prop-row">
            <label>Mass</label>
            <NumberField ariaLabel="Mass" value={rb.mass} min={0.01} max={100000} step={0.1} onChange={(v) => updateRb({ mass: v }, 'mass')} />
          </div>
          {advanced && (
            <>
              <div className="prop-row">
                <label>Gravity ×</label>
                <NumberField ariaLabel="Gravity scale" value={rb.gravityScale} min={-10} max={10} step={0.1} onChange={(v) => updateRb({ gravityScale: v }, 'grav')} />
              </div>
              <div className="prop-row">
                <label>Air drag</label>
                <NumberField ariaLabel="Linear damping" value={rb.linearDamping} min={0} max={100} step={0.05} onChange={(v) => updateRb({ linearDamping: v }, 'ld')} />
              </div>
            </>
          )}
        </>
      )}
      {advanced && collider && (
        <>
          <div className="prop-row">
            <label>Shape</label>
            <SelectField<ColliderShape>
              ariaLabel="Collider shape"
              value={collider.shape}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'box', label: 'Box' },
                { value: 'sphere', label: 'Sphere' },
                { value: 'capsule', label: 'Capsule' },
                { value: 'cylinder', label: 'Cylinder' },
              ]}
              onChange={(v) => session.updateComponents(obj.id, 'Collider shape', { collider: { ...collider, shape: v } })}
            />
          </div>
          <Switch
            label="Trigger (detects touches, doesn’t block)"
            checked={collider.isTrigger}
            onChange={(v) => session.updateComponents(obj.id, 'Trigger', { collider: { ...collider, isTrigger: v } })}
          />
        </>
      )}
    </Section>
  );
}

function ScriptsSection({ session, obj }: { session: EditorSession; obj: SceneObject }) {
  const app = useApp();
  const scripts = useEditor(session, (s) => s.project.scripts);
  const attached = obj.components.scripts ?? [];
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const available = Object.values(scripts).filter((s) => !attached.some((a) => a.scriptId === s.id));
  const openScript = (id: string) => app.openScript(id);
  return (
    <Section title="Scripts" icon={CodeXml} defaultOpen>
      {attached.length === 0 && <p className="small muted">Scripts make objects move, react and score points.</p>}
      {attached.map((a) => {
        const doc = scripts[a.scriptId];
        return (
          <div key={a.scriptId} className="script-chip">
            <CodeXml size={16} aria-hidden="true" />
            <span className="name">{doc?.name ?? 'Missing script'}</span>
            <Switch
              label={`Enable ${doc?.name ?? 'script'}`}
              hideLabel
              checked={a.enabled}
              onChange={(v) =>
                session.updateComponents(obj.id, v ? 'Enable script' : 'Disable script', {
                  scripts: attached.map((x) => (x.scriptId === a.scriptId ? { ...x, enabled: v } : x)),
                })
              }
            />
            {doc && <Button size="sm" onClick={() => openScript(doc.id)}>Edit</Button>}
            <IconButton icon={Link2Off} label="Remove script from object" size="sm" onClick={() => session.detachScript(obj.id, a.scriptId)} />
          </div>
        );
      })}
      <Button icon={Plus} onClick={(e) => setMenu(e.currentTarget)} aria-haspopup="menu">
        Add script
      </Button>
      {menu && (
        <Menu anchor={menu} label="Add script" onClose={() => setMenu(null)}>
          <MenuItem
            icon={Plus}
            label="New block script"
            onSelect={() => {
              const doc = session.createScript(`${obj.name} Script`, 'blocks');
              session.attachScript(obj.id, doc.id);
              openScript(doc.id);
            }}
          />
          {available.length > 0 && <div className="menu-heading">Use an existing script</div>}
          {available.map((s) => (
            <MenuItem key={s.id} icon={CodeXml} label={s.name} onSelect={() => session.attachScript(obj.id, s.id)} />
          ))}
        </Menu>
      )}
    </Section>
  );
}
