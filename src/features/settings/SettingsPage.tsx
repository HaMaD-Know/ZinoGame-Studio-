import { Gamepad2, HardDrive, Info, Keyboard, Monitor, Orbit, Palette, Save, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppController';
import { DEFAULT_PREFERENCES, preferences, usePreferences, type EditorMode, type TextEditorPreference, type ThemePreference, type TouchControlsPreference } from '../../app/preferences';
import { APP_VERSION, BUILD_TIME, useServices } from '../../app/services';
import { useConfirm, useToast } from '../../components/feedback';
import { SelectField, SliderField } from '../../components/fields';
import { Button, Segmented, Switch } from '../../components/ui';
import { detectGraphicsCapabilities, QUALITY_PRESETS, type QualityLevel } from '../../engine/renderer/quality';
import type { StorageUsage } from '../../engine/storage/ProjectStorage';
import { requestPersistentStorage } from '../../engine/storage/IndexedDbProjectStorage';
import { formatBytes } from '../../engine/assets/importers';
import { isNativePlatform, platformName } from '../../platform/platform';

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Palette; children: React.ReactNode }) {
  return (
    <section className="card card-pad" aria-label={title}>
      <h2 className="section-title">
        <Icon size={20} aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const prefs = usePreferences();
  const app = useApp();
  const { storage, persistent } = useServices();
  const toast = useToast();
  const confirm = useConfirm();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [caps] = useState(() => detectGraphicsCapabilities());

  useEffect(() => {
    void storage.estimateUsage().then(setUsage);
  }, [storage]);

  const set = preferences.update.bind(preferences);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">These settings are saved on this device.</p>
          </div>
        </div>
        <div className="settings-grid">
          <Card title="Look & feel" icon={Palette}>
            <Row title="Theme">
              <Segmented<ThemePreference>
                label="Theme"
                value={prefs.theme}
                onChange={(theme) => set({ theme })}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Row>
            <Row
              title="Editor mode"
              description={
                prefs.editorMode === 'beginner'
                  ? 'Beginner: essential tools, labels on buttons, blocks first.'
                  : 'Advanced: every setting, console, collider view and the text code editor.'
              }
            >
              <Segmented<EditorMode>
                label="Editor mode"
                value={prefs.editorMode}
                onChange={(editorMode) => set({ editorMode })}
                options={[
                  { value: 'beginner', label: 'Beginner' },
                  { value: 'advanced', label: 'Advanced' },
                ]}
              />
            </Row>
          </Card>

          <Card title="Graphics" icon={Monitor}>
            <Row title="Quality" description={QUALITY_PRESETS[prefs.quality].description}>
              <Segmented<QualityLevel>
                label="Graphics quality"
                value={prefs.quality}
                onChange={(quality) => set({ quality })}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </Row>
            <Row title="Show grid">
              <Switch label="Show grid" hideLabel checked={prefs.showGrid} onChange={(showGrid) => set({ showGrid })} />
            </Row>
          </Card>

          <Card title="Saving" icon={Save}>
            <Row title="Autosave" description="Saves your project automatically a moment after each change.">
              <Switch label="Autosave" hideLabel checked={prefs.autosave.enabled} onChange={(enabled) => set({ autosave: { ...prefs.autosave, enabled } })} />
            </Row>
            {prefs.autosave.enabled ? (
              <Row title="Wait before saving">
                <SelectField
                  ariaLabel="Autosave delay"
                  value={String(prefs.autosave.delaySeconds)}
                  onChange={(v) => set({ autosave: { ...prefs.autosave, delaySeconds: Number(v) } })}
                  options={[
                    { value: '1', label: '1 second' },
                    { value: '2', label: '2 seconds' },
                    { value: '5', label: '5 seconds' },
                    { value: '15', label: '15 seconds' },
                  ]}
                />
              </Row>
            ) : (
              <p className="small muted" style={{ paddingTop: 8 }}>
                With autosave off, a recovery copy is still kept so a crash never loses your work. Save with ⌘S or the save status.
              </p>
            )}
          </Card>

          <Card title="Camera" icon={Orbit}>
            <Row title="Turn speed">
              <div style={{ width: 200 }}>
                <SliderField ariaLabel="Camera turn speed" min={0.2} max={3} step={0.1} value={prefs.camera.rotateSpeed} onChange={(v) => set({ camera: { ...prefs.camera, rotateSpeed: v } })} />
              </div>
            </Row>
            <Row title="Zoom speed">
              <div style={{ width: 200 }}>
                <SliderField ariaLabel="Camera zoom speed" min={0.2} max={3} step={0.1} value={prefs.camera.zoomSpeed} onChange={(v) => set({ camera: { ...prefs.camera, zoomSpeed: v } })} />
              </div>
            </Row>
            <Row title="Pan speed">
              <div style={{ width: 200 }}>
                <SliderField ariaLabel="Camera pan speed" min={0.2} max={3} step={0.1} value={prefs.camera.panSpeed} onChange={(v) => set({ camera: { ...prefs.camera, panSpeed: v } })} />
              </div>
            </Row>
            <Row title="Invert drag direction">
              <Switch label="Invert drag direction" hideLabel checked={prefs.camera.invertY} onChange={(invertY) => set({ camera: { ...prefs.camera, invertY } })} />
            </Row>
            <p className="small muted" style={{ paddingTop: 8 }}>
              Touch: one finger turns the camera, two fingers move and pinch to zoom. Mouse: left-drag turns, right-drag moves, wheel zooms.
            </p>
          </Card>

          <Card title="Input & editing" icon={Keyboard}>
            <Row title="On-screen game controls" description="Joystick and buttons while playing.">
              <SelectField<TouchControlsPreference>
                ariaLabel="On-screen game controls"
                value={prefs.touchControls}
                onChange={(touchControls) => set({ touchControls })}
                options={[
                  { value: 'auto', label: 'On touch screens' },
                  { value: 'always', label: 'Always' },
                  { value: 'never', label: 'Never' },
                ]}
              />
            </Row>
            <Row title="Code editor" description="Auto uses the full editor when a keyboard/trackpad is available.">
              <SelectField<TextEditorPreference>
                ariaLabel="Code editor"
                value={prefs.textEditor}
                onChange={(textEditor) => set({ textEditor })}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'monaco', label: 'Full editor (Monaco)' },
                  { value: 'simple', label: 'Simple editor' },
                ]}
              />
            </Row>
            <Row title="Snap when moving" description={`Move ${prefs.snapping.translate} · Rotate ${prefs.snapping.rotate}° · Scale ${prefs.snapping.scale}`}>
              <Switch label="Snapping" hideLabel checked={prefs.snapping.enabled} onChange={(enabled) => set({ snapping: { ...prefs.snapping, enabled } })} />
            </Row>
            <Row title="Game sound volume">
              <div style={{ width: 200 }}>
                <SliderField ariaLabel="Game sound volume" min={0} max={1} step={0.05} value={prefs.soundVolume} onChange={(soundVolume) => set({ soundVolume })} />
              </div>
            </Row>
            <p className="small muted" style={{ paddingTop: 8 }}>
              Shortcuts: <kbd>Q</kbd> select <kbd>W</kbd> move <kbd>E</kbd> rotate <kbd>R</kbd> scale <kbd>F</kbd> focus <kbd>⌘Z</kbd> undo <kbd>⌘D</kbd> duplicate{' '}
              <kbd>⌘K</kbd> search <kbd>⌘↵</kbd> play.
            </p>
          </Card>

          <Card title="Storage" icon={HardDrive}>
            <Row title="Where projects are kept" description={persistent ? 'In this app’s private storage on this device.' : 'In memory only (this browser mode blocks saving).'}>
              <span className={`chip ${persistent ? 'chip-success' : 'chip-danger'}`}>{persistent ? 'Saved on device' : 'Not saved'}</span>
            </Row>
            {usage && (
              <Row title="Space used" description={usage.persisted ? 'Protected from automatic clean-up.' : 'The system may clear it if the device runs out of space.'}>
                <span className="chip">
                  {formatBytes(usage.usage)}
                  {usage.quota ? ` of ${formatBytes(usage.quota)}` : ''}
                </span>
              </Row>
            )}
            {usage && !usage.persisted && (
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await requestPersistentStorage();
                  toast({ tone: ok ? 'success' : 'info', title: ok ? 'Storage protected' : 'The browser did not allow this', description: ok ? undefined : 'Export your projects regularly to keep them safe.' });
                  setUsage(await storage.estimateUsage());
                }}
              >
                Protect storage
              </Button>
            )}
            <div className="row row-wrap" style={{ marginTop: 12 }}>
              {app.session && (
                <Button size="sm" onClick={() => void app.exportProject()}>
                  Export current project
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Delete all projects?',
                    message: 'Every project, asset and backup on this device will be deleted. This cannot be undone. Export anything you want to keep first.',
                    confirmLabel: 'Delete everything',
                    danger: true,
                  });
                  if (!ok) return;
                  if (app.session) await app.closeProject();
                  await storage.clearAll();
                  app.refreshProjects();
                  setUsage(await storage.estimateUsage());
                  toast({ tone: 'success', title: 'All projects deleted' });
                }}
              >
                Delete all projects…
              </Button>
            </div>
          </Card>

          <Card title="About" icon={Info}>
            <Row title="ZinoGame Studio" description={`Version ${APP_VERSION}${BUILD_TIME ? ` · built ${new Date(BUILD_TIME).toLocaleDateString()}` : ''}`}>
              <img src="./icons/icon-64.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
            </Row>
            <Row title="Platform" description={isNativePlatform() ? 'Native app (Capacitor)' : 'Web browser'}>
              <span className="chip">{platformName()}</span>
            </Row>
            <Row title="Graphics" description={caps.renderer ?? 'Renderer details unavailable'}>
              <span className={`chip ${caps.webgl2 ? 'chip-success' : 'chip-danger'}`}>{caps.webgl2 ? 'WebGL 2' : 'No WebGL 2'}</span>
            </Row>
            <Row title="WebGPU" description="Detected for a future renderer upgrade; ZinoGame currently renders with WebGL.">
              <span className="chip">{caps.webgpu ? 'Available' : 'Not available'}</span>
            </Row>
          </Card>

          <Card title="Reset" icon={SlidersHorizontal}>
            <Row title="Reset settings" description="Puts every setting on this page back to its default. Projects are not affected.">
              <Button
                size="sm"
                onClick={() => {
                  preferences.update(DEFAULT_PREFERENCES);
                  toast({ tone: 'success', title: 'Settings reset' });
                }}
              >
                Reset
              </Button>
            </Row>
            <Row title="Tutorial tips" description="Show beginner tips again.">
              <Button size="sm" icon={Gamepad2} onClick={() => set({ dismissedTips: [] })}>
                Show tips
              </Button>
            </Row>
          </Card>
        </div>
      </div>
    </div>
  );
}
