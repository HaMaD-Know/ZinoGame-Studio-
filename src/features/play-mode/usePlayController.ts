import { useCallback, useEffect, useRef, useState } from 'react';
import { preferences } from '../../app/preferences';
import { assetCacheFor } from '../../editor/assetCacheRegistry';
import type { EditorSession } from '../../editor/EditorSession';
import { GameAudio } from '../../engine/audio/GameAudio';
import type { EditorViewport } from '../../engine/editor-viewport/EditorViewport';
import { InputState } from '../../engine/input/InputState';
import { compileScriptsForRuntime } from '../../engine/runtime/compileScripts';
import { GameRuntime, type ScriptErrorInfo } from '../../engine/runtime/GameRuntime';

export interface PlayMessage {
  id: number;
  text: string;
}

export interface PlayController {
  playing: boolean;
  starting: boolean;
  score: number;
  messages: PlayMessage[];
  errors: ScriptErrorInfo[];
  fatal: string | null;
  input: InputState;
  hasPlayer: boolean;
  start: () => Promise<void>;
  stop: () => void;
  zoom: (delta: number) => void;
}

/**
 * Owns play mode: compiles scripts, pauses the editor viewport, runs the
 * GameRuntime in the same canvas and restores the editor on stop.
 */
export function usePlayController(
  session: EditorSession,
  viewport: EditorViewport | null,
  onPlayed?: () => void,
): PlayController {
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [score, setScore] = useState(0);
  const [messages, setMessages] = useState<PlayMessage[]>([]);
  const [errors, setErrors] = useState<ScriptErrorInfo[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [hasPlayer, setHasPlayer] = useState(false);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const inputRef = useRef(new InputState());
  const audioRef = useRef<GameAudio | null>(null);
  const messageId = useRef(0);
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;

  const stop = useCallback(() => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    inputRef.current.detach();
    viewport?.resume();
    session.setPlayState('edit');
    setPlaying(false);
    setStarting(false);
    setMessages([]);
  }, [session, viewport]);

  const start = useCallback(async () => {
    if (!viewport || runtimeRef.current || starting) return;
    setStarting(true);
    setErrors([]);
    setFatal(null);
    setScore(0);
    setMessages([]);
    session.setPlayState('starting');
    // Audio must be unlocked inside the user gesture on iOS.
    if (!audioRef.current) audioRef.current = new GameAudio(session.loadAssetDataByName);
    audioRef.current.unlock();
    audioRef.current.setVolume(preferences.get().soundVolume);
    const project = session.project;
    const prefs = preferences.get();
    const camera = viewport.getCameraState();
    viewport.pause();
    try {
      const runtime = await GameRuntime.start({
        scene: session.scene,
        settings: project.manifest.settings,
        assets: project.assets,
        scripts: compileScriptsForRuntime(project.scripts),
        assetCache: assetCacheFor(session),
        input: inputRef.current,
        context: viewport.context,
        audio: audioRef.current,
        fallbackCamera: camera,
        showColliders: prefs.showColliders && prefs.editorMode === 'advanced',
        callbacks: {
          onMessage: (text) => {
            const id = ++messageId.current;
            setMessages((list) => [...list.slice(-2), { id, text }]);
            setTimeout(() => setMessages((list) => list.filter((m) => m.id !== id)), 3500);
          },
          onScore: setScore,
          onLog: (level, message) => session.log(level, message, 'Game'),
          onScriptError: (info) => {
            setErrors((list) => [...list, info]);
            session.log('error', `${info.scriptName} on "${info.objectName}"${info.line ? ` (line ${info.line})` : ''}: ${info.message}`, 'Script');
          },
          onFatal: (message) => {
            setFatal(message);
            session.log('error', message, 'Game');
          },
        },
      });
      runtimeRef.current = runtime;
      inputRef.current.attach(window);
      setHasPlayer(runtime.hasPlayer);
      session.setPlayState('playing');
      setPlaying(true);
      onPlayedRef.current?.();
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      setFatal(message);
      session.log('error', `Play mode could not start: ${message}`, 'Game');
      viewport.resume();
      session.setPlayState('edit');
    } finally {
      setStarting(false);
    }
  }, [session, viewport, starting]);

  // Stop the game if the viewport goes away or the component unmounts.
  useEffect(() => () => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    inputRef.current.detach();
  }, [viewport]);

  useEffect(() => () => audioRef.current?.dispose(), []);

  const zoom = useCallback((delta: number) => runtimeRef.current?.zoom(delta), []);

  return { playing, starting, score, messages, errors, fatal, input: inputRef.current, hasPlayer, start, stop, zoom };
}
