import { CircleAlert, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../../app/preferences';
import { Button } from '../../components/ui';
import { isTouchDevice } from '../../platform/platform';
import type { PlayController } from './usePlayController';

/** HUD shown over the viewport while playing: score, messages, errors and touch controls. */
export function PlayOverlay({ play, showScore }: { play: PlayController; showScore: boolean }) {
  const prefs = usePreferences();
  const showTouch = prefs.touchControls === 'always' || (prefs.touchControls === 'auto' && isTouchDevice());
  const lookRef = useRef<HTMLDivElement>(null);

  // Drag anywhere on the game view to look around; wheel / pinch to zoom.
  useEffect(() => {
    const el = lookRef.current;
    if (!el) return;
    let last: { id: number; x: number; y: number } | null = null;
    const pinch = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    const down = (e: PointerEvent) => {
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        last = null;
        return;
      }
      last = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist > 0) play.zoom((pinchDist - d) / 300);
        pinchDist = d;
        return;
      }
      if (!last || last.id !== e.pointerId) return;
      play.input.addLook(e.clientX - last.x, e.clientY - last.y);
      last = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      pinch.delete(e.pointerId);
      if (last?.id === e.pointerId) last = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      play.zoom(e.deltaY / 800);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [play]);

  return (
    <div className="play-overlay" data-testid="play-overlay">
      <div ref={lookRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} aria-label="Game view. Drag to look around." role="application" />
      <div className="play-top">
        {showScore ? (
          <div className="score-pill" aria-live="polite">
            Score: {play.score}
          </div>
        ) : (
          <span />
        )}
        <Button variant="stop" icon={Square} onClick={play.stop}>
          Stop
        </Button>
      </div>
      <div className="game-messages" aria-live="polite">
        {play.messages.map((m) => (
          <div key={m.id} className="game-message">
            {m.text}
          </div>
        ))}
      </div>
      {(play.errors.length > 0 || play.fatal) && (
        <div className="play-errors" role="alert">
          <div className="row" style={{ marginBottom: 4 }}>
            <CircleAlert size={16} aria-hidden="true" />
            <strong>{play.fatal ? 'The game stopped' : 'Script problems'}</strong>
          </div>
          {play.fatal && <div>{play.fatal}</div>}
          {play.errors.slice(-4).map((e, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              <strong>{e.scriptName}</strong> on “{e.objectName}”{e.line ? ` (line ${e.line})` : ''}: {e.message}
            </div>
          ))}
        </div>
      )}
      {showTouch && <TouchControls play={play} />}
    </div>
  );
}

function TouchControls({ play }: { play: PlayController }) {
  const knob = useRef<HTMLDivElement>(null);
  const [jumpDown, setJumpDown] = useState(false);
  const [actionDown, setActionDown] = useState(false);
  const active = useRef<number | null>(null);

  const moveKnob = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const r = rect.width / 2;
    let dx = e.clientX - (rect.left + r);
    let dy = e.clientY - (rect.top + r);
    const len = Math.hypot(dx, dy);
    const max = r - 20;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    play.input.setJoystick(dx / max, -dy / max);
  };
  const release = () => {
    active.current = null;
    if (knob.current) knob.current.style.transform = '';
    play.input.setJoystick(0, 0);
  };

  const button = (name: string, set: (v: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      set(true);
      play.input.setVirtualButton(name, true);
    },
    onPointerUp: () => {
      set(false);
      play.input.setVirtualButton(name, false);
    },
    onPointerCancel: () => {
      set(false);
      play.input.setVirtualButton(name, false);
    },
  });

  return (
    <div className="touch-controls">
      {play.hasPlayer && (
        <div
          className="joystick"
          role="slider"
          aria-label="Move joystick"
          aria-valuetext="Drag to move"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            active.current = e.pointerId;
            moveKnob(e);
          }}
          onPointerMove={(e) => active.current === e.pointerId && moveKnob(e)}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <div ref={knob} className="joystick-knob" />
        </div>
      )}
      <div className="action-buttons">
        <button type="button" className="game-btn secondary" data-down={actionDown} aria-label="Action button" {...button('action', setActionDown)}>
          Action
        </button>
        <button type="button" className="game-btn" data-down={jumpDown} aria-label="Jump button" {...button('jump', setJumpDown)}>
          Jump
        </button>
      </div>
    </div>
  );
}
