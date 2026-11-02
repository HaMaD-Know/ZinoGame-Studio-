import { Blocks, Box, CodeXml, House, Settings, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ConfirmProvider, ToastProvider } from '../components/feedback';
import { Spinner } from '../components/ui';
import { requestPersistentStorage } from '../engine/storage/IndexedDbProjectStorage';
import { HomePage } from '../features/home/HomePage';
import { EditorWorkspace } from '../features/scene-editor/EditorWorkspace';
import { SettingsPage } from '../features/settings/SettingsPage';
import { configureStatusBar } from '../platform/platform';
import { AppControllerProvider, useApp, type Route } from './AppController';
import { applyTheme, resolvedTheme, usePreferences } from './preferences';
import { createStorage, ServicesProvider, type AppServices } from './services';

// Large editors load only when needed.
const AssetsPage = lazy(() => import('../features/assets/AssetsPage'));
const ScriptsPage = lazy(() => import('../features/scripts/ScriptsPage'));

export function App() {
  const prefs = usePreferences();
  const [services, setServices] = useState<AppServices | null>(null);

  useEffect(() => {
    void createStorage().then(setServices);
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    applyTheme(prefs.theme);
    void configureStatusBar(resolvedTheme(prefs.theme));
    if (prefs.theme !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => void configureStatusBar(resolvedTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs.theme]);

  if (!services) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Spinner label="Starting ZinoGame Studio" />
      </div>
    );
  }

  return (
    <ServicesProvider services={services}>
      <ToastProvider>
        <ConfirmProvider>
          <AppControllerProvider>
            <Shell />
          </AppControllerProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ServicesProvider>
  );
}

const NAV: { route: Route; label: string; icon: LucideIcon; needsProject: boolean }[] = [
  { route: 'home', label: 'Home', icon: House, needsProject: false },
  { route: 'create', label: 'Create', icon: Box, needsProject: true },
  { route: 'assets', label: 'Assets', icon: Blocks, needsProject: true },
  { route: 'scripts', label: 'Scripts', icon: CodeXml, needsProject: true },
  { route: 'settings', label: 'Settings', icon: Settings, needsProject: false },
];

function NavButtons() {
  const { route, navigate, session } = useApp();
  return (
    <>
      {NAV.map((item) => {
        const disabled = item.needsProject && !session;
        return (
          <button
            key={item.route}
            type="button"
            className="nav-item"
            aria-current={route === item.route ? 'page' : undefined}
            disabled={disabled}
            title={disabled ? 'Open or create a project first' : undefined}
            onClick={() => navigate(item.route)}
          >
            <item.icon size={22} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </>
  );
}

function Shell() {
  const { route, session } = useApp();
  return (
    <div className="app">
      <nav className="nav-rail" aria-label="Main">
        <img className="nav-logo" src="./icons/icon-192.png" alt="ZinoGame Studio" />
        <NavButtons />
        <div className="nav-spacer" />
      </nav>
      <main className="app-main">
        {route === 'home' && <HomePage />}
        {/* The editor stays mounted while a project is open so the 3D view is not rebuilt on every tab switch. */}
        {session && <EditorWorkspace key={session.project.manifest.id} hidden={route !== 'create'} />}
        <Suspense
          fallback={
            <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
              <Spinner />
            </div>
          }
        >
          {route === 'assets' && session && <AssetsPage />}
          {route === 'scripts' && session && <ScriptsPage />}
        </Suspense>
        {route === 'settings' && <SettingsPage />}
      </main>
      <nav className="tab-bar" aria-label="Main">
        <NavButtons />
      </nav>
    </div>
  );
}
