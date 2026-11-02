/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the same build works inside the Capacitor WebView,
  // on a static web host sub-path, and from `vite preview`.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: ['es2022', 'safari16'],
    sourcemap: false,
    // Monaco, Blockly and Rapier are intentionally lazy-loaded; they are large
    // by nature, so raise the warning threshold instead of hiding real issues.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (id.includes('/react') || id.includes('/scheduler/')) return 'react';
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    testTimeout: 20000,
  },
});
