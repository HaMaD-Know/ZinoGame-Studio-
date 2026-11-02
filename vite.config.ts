/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const BLOCKLY_MEDIA = fileURLToPath(new URL('./node_modules/blockly/media', import.meta.url));

/**
 * Serves Blockly's UI media (zoom/trash icons, cursors) from the installed
 * package in dev and copies it into the build, so the block editor never
 * fetches anything from the internet (required for offline iPad use).
 */
function blocklyMedia(): Plugin {
  const types: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.cur': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
  let outDir = 'dist';
  let isBuild = false;
  return {
    name: 'zino-blockly-media',
    configResolved(config) {
      outDir = config.build.outDir;
      // Vitest also closes a Vite server (with a placeholder outDir): only copy for real builds.
      isBuild = config.command === 'build' && !process.env.VITEST;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/blockly-media\/([^?#]+)/.exec(req.url ?? '');
        if (!m) return next();
        const file = normalize(join(BLOCKLY_MEDIA, decodeURIComponent(m[1] as string)));
        if (!file.startsWith(BLOCKLY_MEDIA) || !existsSync(file)) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (isBuild && existsSync(BLOCKLY_MEDIA)) cpSync(BLOCKLY_MEDIA, join(outDir, 'blockly-media'), { recursive: true });
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the same build works inside the Capacitor WebView,
  // on a static web host sub-path, and from `vite preview`.
  base: './',
  plugins: [react(), blocklyMedia()],
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    testTimeout: 20000,
  },
});
