import { useSyncExternalStore } from 'react';
import type { QualityLevel } from '../engine/renderer/quality';

/**
 * User preferences (per device). Stored in localStorage, which is fine for
 * small per-viewer settings; project data lives in ProjectStorage.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type EditorMode = 'beginner' | 'advanced';
export type TextEditorPreference = 'auto' | 'monaco' | 'simple';
export type TouchControlsPreference = 'auto' | 'always' | 'never';

export interface Preferences {
  theme: ThemePreference;
  editorMode: EditorMode;
  quality: QualityLevel;
  autosave: { enabled: boolean; delaySeconds: number };
  camera: { rotateSpeed: number; zoomSpeed: number; panSpeed: number; invertY: boolean };
  touchControls: TouchControlsPreference;
  textEditor: TextEditorPreference;
  snapping: { enabled: boolean; translate: number; rotate: number; scale: number };
  showColliders: boolean;
  showGrid: boolean;
  soundVolume: number;
  panels: { hierarchy: boolean; inspector: boolean; bottom: boolean };
  dismissedTips: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  editorMode: 'beginner',
  quality: 'medium',
  autosave: { enabled: true, delaySeconds: 2 },
  camera: { rotateSpeed: 1, zoomSpeed: 1, panSpeed: 1, invertY: false },
  touchControls: 'auto',
  textEditor: 'auto',
  snapping: { enabled: false, translate: 1, rotate: 15, scale: 0.1 },
  showColliders: false,
  showGrid: true,
  soundVolume: 0.6,
  panels: { hierarchy: true, inspector: true, bottom: false },
  dismissedTips: [],
};

const KEY = 'zinogame.preferences.v1';

function load(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      autosave: { ...DEFAULT_PREFERENCES.autosave, ...parsed.autosave },
      camera: { ...DEFAULT_PREFERENCES.camera, ...parsed.camera },
      snapping: { ...DEFAULT_PREFERENCES.snapping, ...parsed.snapping },
      panels: { ...DEFAULT_PREFERENCES.panels, ...parsed.panels },
      dismissedTips: Array.isArray(parsed.dismissedTips) ? parsed.dismissedTips : [],
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

class PreferencesStore {
  private value: Preferences = load();
  private listeners = new Set<() => void>();

  get = (): Preferences => this.value;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  update(patch: Partial<Preferences> | ((p: Preferences) => Partial<Preferences>)): void {
    const p = typeof patch === 'function' ? patch(this.value) : patch;
    this.value = { ...this.value, ...p };
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Storage can be unavailable (private mode); preferences still work for this session.
    }
    for (const l of [...this.listeners]) l();
  }

  reset(): void {
    this.update(DEFAULT_PREFERENCES);
  }
}

export const preferences = new PreferencesStore();

export function usePreferences(): Preferences {
  return useSyncExternalStore(preferences.subscribe, preferences.get, preferences.get);
}

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function resolvedTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
