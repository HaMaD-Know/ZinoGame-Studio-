import { Capacitor } from '@capacitor/core';

/**
 * Platform abstraction. Everything that differs between the web and the
 * native (Capacitor) app goes through here so editor code stays portable.
 * Native plugins are imported lazily so the web build never loads them.
 */

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platformName(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

export function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** True when a precise pointer (mouse/trackpad) is available, e.g. iPad with Magic Keyboard. */
export function hasFinePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface SaveFileResult {
  /** Where the file went, in words a user understands. */
  location: string;
}

/**
 * Saves a file for the user. On iOS/iPadOS it is written to the app's
 * Documents folder (visible in the Files app under "On My iPad →
 * ZinoGame Studio") and the share sheet is offered. On the web it downloads.
 */
export async function saveFileForUser(fileName: string, data: Uint8Array, mimeType: string): Promise<SaveFileResult> {
  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = `Exports/${fileName}`;
    const written = await Filesystem.writeFile({
      path,
      data: toBase64(data),
      directory: Directory.Documents,
      recursive: true,
    });
    try {
      const { Share } = await import('@capacitor/share');
      if ((await Share.canShare()).value) {
        await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Save or send your project' });
      }
    } catch {
      // The user may cancel the share sheet; the file is already saved.
    }
    return { location: `Files app › On My iPad › ZinoGame Studio › Exports › ${fileName}` };
  }
  const blob = new Blob([data.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { location: `your Downloads folder (${fileName})` };
}

/** Opens the system file picker. Works in browsers and in the iOS WebView (Files app picker). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? [...input.files] : []));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Native app lifecycle: save when the app goes to the background. */
export async function onAppBackground(callback: () => void): Promise<() => void> {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') callback();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', callback);
  let removeNative: (() => void) | null = null;
  if (isNativePlatform()) {
    try {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('pause', callback);
      removeNative = () => void handle.remove();
    } catch {
      removeNative = null;
    }
  }
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', callback);
    removeNative?.();
  };
}

/** Matches the iOS status bar to the app theme. */
export async function configureStatusBar(theme: 'light' | 'dark'): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
  } catch {
    // Status bar plugin is optional.
  }
}
