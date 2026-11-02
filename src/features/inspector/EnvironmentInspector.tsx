import { Cloud, CloudFog, Footprints, Globe } from 'lucide-react';
import { usePreferences } from '../../app/preferences';
import { useEditor } from '../../app/services';
import { ColorField, NumberField, SelectField, SliderField } from '../../components/fields';
import { Section, Segmented, Switch } from '../../components/ui';
import type { EditorSession } from '../../editor/EditorSession';
import type { CameraMode } from '../../engine/project/types';
import type { EnvironmentSettings } from '../../engine/scene/types';

const SKY_PRESETS: { name: string; sky: EnvironmentSettings['sky']; ambient: string }[] = [
  { name: 'Day', sky: { topColor: '#4a8fe7', horizonColor: '#cfe6ff', bottomColor: '#8a9bb0' }, ambient: '#bcd4ff' },
  { name: 'Sunset', sky: { topColor: '#3b3f8f', horizonColor: '#ff9e6b', bottomColor: '#5a4a6a' }, ambient: '#ffc9a8' },
  { name: 'Night', sky: { topColor: '#05070f', horizonColor: '#1c2550', bottomColor: '#0a0d18' }, ambient: '#5b6ca8' },
  { name: 'Candy', sky: { topColor: '#ff8fd0', horizonColor: '#fff0a8', bottomColor: '#a8e6ff' }, ambient: '#ffe0f4' },
];

export function EnvironmentInspector({ session }: { session: EditorSession }) {
  const prefs = usePreferences();
  const advanced = prefs.editorMode === 'advanced';
  const env = useEditor(session, (s) => s.project.scenes[s.sceneId]?.environment);
  const settings = useEditor(session, (s) => s.project.manifest.settings);
  if (!env) return null;
  const update = (patch: Partial<EnvironmentSettings>, key?: string) => session.updateEnvironment(patch, key ? `env:${key}` : undefined);
  const player = settings.player;
  const updatePlayer = (patch: Partial<typeof player>) => session.updateSettings({ player: { ...player, ...patch } });

  return (
    <div data-testid="environment-inspector">
      <div className="inspector-title">
        <div className="type-icon">
          <Globe size={22} aria-hidden="true" />
        </div>
        <div>
          <strong>Environment &amp; Sky</strong>
          <p className="small faint">Sky, light and player settings for this world</p>
        </div>
      </div>
      <Section title="Sky" icon={Cloud}>
        <div className="preset-grid" role="group" aria-label="Sky presets">
          {SKY_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={env.sky.topColor === p.sky.topColor && env.sky.horizonColor === p.sky.horizonColor}
              style={{ background: `linear-gradient(${p.sky.topColor}, ${p.sky.horizonColor})`, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}
              onClick={() => update({ sky: p.sky, ambientColor: p.ambient, background: 'sky' })}
            >
              {p.name}
            </button>
          ))}
        </div>
        <Segmented
          label="Background"
          value={env.background}
          options={[
            { value: 'sky', label: 'Sky gradient' },
            { value: 'color', label: 'Solid colour' },
          ]}
          onChange={(v) => update({ background: v })}
        />
        {env.background === 'sky' ? (
          <>
            <div className="prop-stack">
              <span className="field-label">Top</span>
              <ColorField ariaLabel="Sky top colour" swatches={false} value={env.sky.topColor} onChange={(c) => update({ sky: { ...env.sky, topColor: c } }, 'top')} />
            </div>
            <div className="prop-stack">
              <span className="field-label">Horizon</span>
              <ColorField ariaLabel="Sky horizon colour" swatches={false} value={env.sky.horizonColor} onChange={(c) => update({ sky: { ...env.sky, horizonColor: c } }, 'hor')} />
            </div>
            {advanced && (
              <div className="prop-stack">
                <span className="field-label">Ground</span>
                <ColorField ariaLabel="Sky ground colour" swatches={false} value={env.sky.bottomColor} onChange={(c) => update({ sky: { ...env.sky, bottomColor: c } }, 'bot')} />
              </div>
            )}
          </>
        ) : (
          <div className="prop-stack">
            <span className="field-label">Background colour</span>
            <ColorField ariaLabel="Background colour" value={env.backgroundColor} onChange={(c) => update({ backgroundColor: c }, 'bg')} />
          </div>
        )}
        <div className="prop-stack">
          <span className="field-label">Ambient light</span>
          <SliderField ariaLabel="Ambient light" min={0} max={3} step={0.05} value={env.ambientIntensity} onChange={(v) => update({ ambientIntensity: v }, 'amb')} />
        </div>
        {advanced && (
          <>
            <div className="prop-stack">
              <span className="field-label">Ambient colour</span>
              <ColorField ariaLabel="Ambient colour" swatches={false} value={env.ambientColor} onChange={(c) => update({ ambientColor: c }, 'ambc')} />
            </div>
            <div className="prop-stack">
              <span className="field-label">Reflections (image lighting)</span>
              <SliderField ariaLabel="Reflections" min={0} max={3} step={0.05} value={env.environmentIntensity} onChange={(v) => update({ environmentIntensity: v }, 'ibl')} />
            </div>
          </>
        )}
      </Section>
      <Section title="Fog" icon={CloudFog} defaultOpen={env.fog.enabled}>
        <Switch label="Fog" checked={env.fog.enabled} onChange={(v) => update({ fog: { ...env.fog, enabled: v } })} />
        {env.fog.enabled && (
          <>
            <div className="prop-stack">
              <span className="field-label">Fog colour</span>
              <ColorField ariaLabel="Fog colour" swatches={false} value={env.fog.color} onChange={(c) => update({ fog: { ...env.fog, color: c } }, 'fogc')} />
            </div>
            <div className="prop-row">
              <label>Starts at</label>
              <NumberField ariaLabel="Fog start" value={env.fog.near} min={0} step={5} onChange={(v) => update({ fog: { ...env.fog, near: v } }, 'fogn')} />
            </div>
            <div className="prop-row">
              <label>Thick at</label>
              <NumberField ariaLabel="Fog end" value={env.fog.far} min={1} step={5} onChange={(v) => update({ fog: { ...env.fog, far: v } }, 'fogf')} />
            </div>
          </>
        )}
      </Section>
      <Section title="Player & world" icon={Footprints}>
        <Switch label="Spawn a player at the spawn point" checked={player.enabled} onChange={(v) => updatePlayer({ enabled: v })} />
        {player.enabled && (
          <>
            <div className="prop-stack">
              <span className="field-label">Walk speed</span>
              <SliderField ariaLabel="Walk speed" min={1} max={30} step={0.5} value={player.moveSpeed} onChange={(v) => updatePlayer({ moveSpeed: v })} />
            </div>
            <div className="prop-stack">
              <span className="field-label">Jump power</span>
              <SliderField ariaLabel="Jump power" min={0} max={30} step={0.5} value={player.jumpPower} onChange={(v) => updatePlayer({ jumpPower: v })} />
            </div>
            <div className="prop-row">
              <label>Camera</label>
              <SelectField<CameraMode>
                ariaLabel="Player camera"
                value={player.cameraMode}
                options={[
                  { value: 'thirdPerson', label: 'Behind the player' },
                  { value: 'firstPerson', label: 'Through the eyes' },
                ]}
                onChange={(v) => updatePlayer({ cameraMode: v })}
              />
            </div>
            <div className="prop-stack">
              <span className="field-label">Player colour</span>
              <ColorField ariaLabel="Player colour" value={player.color} onChange={(c) => updatePlayer({ color: c })} />
            </div>
          </>
        )}
        <Switch label="Show score while playing" checked={settings.showScore} onChange={(v) => session.updateSettings({ showScore: v })} />
        {advanced && (
          <div className="prop-row">
            <label>Gravity</label>
            <NumberField ariaLabel="Gravity" value={env.gravity} min={-100} max={100} step={0.5} onChange={(v) => update({ gravity: v }, 'grav')} />
          </div>
        )}
      </Section>
    </div>
  );
}
