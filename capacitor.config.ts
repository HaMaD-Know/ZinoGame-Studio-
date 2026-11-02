import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zinogame.studio',
  appName: 'ZinoGame Studio',
  webDir: 'dist',
  // The app works fully offline: all assets are bundled, nothing is loaded remotely.
  ios: {
    contentInset: 'never',
    backgroundColor: '#0b1020',
    // Allow the Safari Web Inspector to attach to debug builds.
    webContentsDebuggingEnabled: true,
    // Keep the keyboard from resizing the 3D viewport.
    scrollEnabled: false,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
    },
  },
};

export default config;
