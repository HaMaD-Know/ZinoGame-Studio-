import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { EditorSession, EditorState } from '../editor/EditorSession';
import { IndexedDbProjectStorage } from '../engine/storage/IndexedDbProjectStorage';
import { MemoryProjectStorage } from '../engine/storage/MemoryProjectStorage';
import type { ProjectStorage } from '../engine/storage/ProjectStorage';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

export interface AppServices {
  storage: ProjectStorage;
  /** False when IndexedDB was unavailable and projects only live in memory. */
  persistent: boolean;
}

/** Picks the best available storage backend. */
export async function createStorage(): Promise<AppServices> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const storage = new IndexedDbProjectStorage();
      await storage.listProjects();
      return { storage, persistent: true };
    } catch {
      // Fall through to memory storage (e.g. private browsing modes that block IndexedDB).
    }
  }
  return { storage: new MemoryProjectStorage(), persistent: false };
}

const ServicesContext = createContext<AppServices | null>(null);
const SessionContext = createContext<EditorSession | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function SessionProvider({ session, children }: { session: EditorSession | null; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside ServicesProvider');
  return s;
}

export function useSession(): EditorSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('No project is open');
  return s;
}

export function useOptionalSession(): EditorSession | null {
  return useContext(SessionContext);
}

/** Subscribes to a slice of editor state. Selectors must return stable references. */
export function useEditor<T>(session: EditorSession, selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    session.subscribe,
    () => selector(session.getState()),
    () => selector(session.getState()),
  );
}
