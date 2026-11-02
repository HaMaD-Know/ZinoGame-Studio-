import { MonitorX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { useToast } from '../../components/feedback';
import { Button } from '../../components/ui';
import { assetCacheFor } from '../../editor/assetCacheRegistry';
import type { EditorSession } from '../../editor/EditorSession';
import { EditorViewport } from '../../engine/editor-viewport/EditorViewport';
import { QUALITY_PRESETS } from '../../engine/renderer/quality';
import { RendererInitError } from '../../engine/renderer/RenderContext';

/**
 * Mounts the framework-agnostic EditorViewport and keeps it in sync with the
 * session by subscribing directly (not through React renders), so dragging
 * and editing never re-render the 3D view through React.
 */
export function ViewportPanel({
  session,
  hidden,
  onViewport,
}: {
  session: EditorSession;
  hidden: boolean;
  onViewport: (viewport: EditorViewport | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const prefs = usePreferences();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [generation, setGeneration] = useState(0);
  const viewportRef = useRef<EditorViewport | null>(null);
  const antialiasRef = useRef(QUALITY_PRESETS[prefs.quality].antialias);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let viewport: EditorViewport;
    try {
      viewport = new EditorViewport(host, assetCacheFor(session), prefs.quality, {
        onPick: (id, additive) => {
          if (session.isPlaying) return;
          if (id) session.select([id], additive);
          else if (!additive) session.clearSelection();
        },
        onTransformPreview: (changes) => session.previewTransforms(changes),
        onTransformCommit: (changes) => {
          const mode = viewport.gizmo.mode;
          session.commitTransforms(changes, mode === 'rotate' ? 'Rotate' : mode === 'scale' ? 'Scale' : 'Move');
        },
        onCameraChange: (position, target) => session.setEditorView(position, target),
        onAssetError: (name, message) => {
          session.log('error', `Could not load "${name}": ${message}`, 'Assets');
          toastRef.current({ tone: 'error', title: `Could not load "${name}"`, description: message });
        },
        onContextLost: () => setContextLost(true),
        onContextRestored: () => setContextLost(false),
      });
    } catch (err) {
      setError(err instanceof RendererInitError ? err.message : `The 3D view could not start: ${(err as Error).message}`);
      onViewport(null);
      return;
    }
    antialiasRef.current = viewport.context.antialias;
    viewportRef.current = viewport;
    setError(null);

    // Push session state into the viewport whenever it changes.
    let lastScene: unknown = null;
    let lastAssets: unknown = null;
    let lastSelection: unknown = null;
    let lastTool: unknown = null;
    let lastSpace: unknown = null;
    let lastPlay: unknown = null;
    const apply = () => {
      const s = session.getState();
      const scene = session.scene;
      if (scene !== lastScene || s.project.assets !== lastAssets) {
        lastScene = scene;
        lastAssets = s.project.assets;
        viewport.setScene(scene, s.project.assets);
      }
      if (s.selection !== lastSelection) {
        lastSelection = s.selection;
        viewport.setSelection(s.selection);
      }
      if (s.tool !== lastTool) {
        lastTool = s.tool;
        viewport.setMode(s.tool);
      }
      if (s.space !== lastSpace) {
        lastSpace = s.space;
        viewport.setSpace(s.space);
      }
      if (s.playState !== lastPlay) {
        lastPlay = s.playState;
      }
    };
    apply();
    const unsubscribe = session.subscribe(apply);
    session.setThumbnailProvider(() => viewport.captureThumbnail());
    onViewport(viewport);
    return () => {
      unsubscribe();
      session.setThumbnailProvider(null);
      onViewport(null);
      viewportRef.current = null;
      viewport.dispose();
    };
    // The viewport is rebuilt only when the session changes or a rebuild is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, generation]);

  // Preferences that can be applied live.
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    v.setShowGrid(prefs.showGrid);
    v.setShowColliders(prefs.showColliders && prefs.editorMode === 'advanced');
    v.setSnap(
      prefs.snapping.enabled
        ? { translate: prefs.snapping.translate, rotate: prefs.snapping.rotate, scale: prefs.snapping.scale }
        : { translate: null, rotate: null, scale: null },
    );
    v.setCameraSettings(prefs.camera);
    if (v.setQuality(prefs.quality) && QUALITY_PRESETS[prefs.quality].antialias !== antialiasRef.current) {
      // Antialiasing can only change with a new WebGL context.
      setGeneration((g) => g + 1);
    }
  }, [prefs.showGrid, prefs.showColliders, prefs.editorMode, prefs.snapping, prefs.camera, prefs.quality, generation, error]);

  // Pause rendering while another tab is shown.
  useEffect(() => {
    const v = viewportRef.current;
    if (!v || session.isPlaying) return;
    if (hidden) v.pause();
    else v.resume();
  }, [hidden, session]);

  return (
    <>
      <div ref={hostRef} className="viewport-host" data-testid="viewport" />
      {error && (
        <div className="viewport-message">
          <div className="card stack" role="alert">
            <MonitorX size={36} aria-hidden="true" style={{ margin: '0 auto', color: 'var(--danger)' }} />
            <h3>3D view unavailable</h3>
            <p className="small muted">{error}</p>
            <p className="small muted">
              You can still edit objects with the Hierarchy and Inspector panels. Try lowering Graphics quality in Settings, or restart
              the app.
            </p>
            <Button onClick={() => setGeneration((g) => g + 1)}>Try again</Button>
          </div>
        </div>
      )}
      {contextLost && !error && (
        <div className="viewport-message">
          <div className="card stack" role="status">
            <h3>Restoring the 3D view…</h3>
            <p className="small muted">The graphics system was reset by the device. Your project is safe.</p>
            <Button onClick={() => setGeneration((g) => g + 1)}>Reload 3D view</Button>
          </div>
        </div>
      )}
    </>
  );
}
