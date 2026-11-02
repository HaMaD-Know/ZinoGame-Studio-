import { Check, GraduationCap, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../app/services';
import { Button, IconButton } from '../../components/ui';
import type { EditorSession } from '../../editor/EditorSession';
import type { SceneData } from '../../engine/scene/types';
import { TUTORIALS, type TutorialId } from './tutorials';

export function GuidePanel({
  session,
  tutorialId,
  hasPlayed,
  onClose,
}: {
  session: EditorSession;
  tutorialId: TutorialId;
  hasPlayed: boolean;
  onClose: () => void;
}) {
  const tutorial = TUTORIALS.find((t) => t.id === tutorialId);
  const state = useEditor(session, (s) => s);
  const startScene = useRef<SceneData>(session.scene);
  const [minimized, setMinimized] = useState(false);
  const scene = state.project.scenes[state.sceneId] as SceneData;

  const progress = useMemo(() => {
    if (!tutorial) return [];
    const ctx = { state, scene, startScene: startScene.current, hasPlayed };
    // Steps complete in order: a later step only counts once earlier ones are done.
    let allBefore = true;
    return tutorial.steps.map((step) => {
      const done = allBefore && step.done(ctx);
      allBefore = done;
      return done;
    });
  }, [tutorial, state, scene, hasPlayed]);

  useEffect(() => {
    startScene.current = session.scene;
  }, [tutorialId, session]);

  if (!tutorial) return null;
  const finished = progress.every(Boolean);
  const current = progress.findIndex((d) => !d);

  if (minimized) {
    return (
      <div className="guide-panel card" style={{ width: 'auto', padding: 8 }}>
        <Button size="sm" icon={GraduationCap} onClick={() => setMinimized(false)}>
          {tutorial.title} · {progress.filter(Boolean).length}/{progress.length}
        </Button>
      </div>
    );
  }

  return (
    <aside className="guide-panel card" aria-label={`Tutorial: ${tutorial.title}`}>
      <div className="row" style={{ marginBottom: 6 }}>
        <GraduationCap size={18} aria-hidden="true" style={{ color: 'var(--brand-orange)' }} />
        <strong style={{ flex: 1 }}>{tutorial.title}</strong>
        <Button size="sm" variant="ghost" onClick={() => setMinimized(true)}>
          Hide
        </Button>
        <IconButton icon={X} label="Close tutorial" size="sm" onClick={onClose} />
      </div>
      {tutorial.steps.map((step, i) => (
        <div key={i} className="guide-step" data-done={progress[i]}>
          <span className="check" aria-hidden="true">
            {progress[i] && <Check size={14} />}
          </span>
          <div>
            <div className="text" style={i === current ? { fontWeight: 700 } : undefined}>
              {step.text}
            </div>
            {i === current && step.hint && <div className="small muted">{step.hint}</div>}
          </div>
          <span className="sr-only">{progress[i] ? 'done' : 'not done yet'}</span>
        </div>
      ))}
      {finished && (
        <div className="banner" style={{ marginTop: 8 }} role="status">
          <span>🎉 You finished “{tutorial.title}”! Try another tutorial from Home.</span>
        </div>
      )}
    </aside>
  );
}
