import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (`vite preview`).
 * Chromium runs everywhere; WebKit (closest to iPad Safari / WKWebView) runs
 * when PW_WEBKIT=1 and the WebKit browser is installed (it is in CI).
 * Note: Playwright's WebKit is not identical to iPadOS WebKit; real-device
 * testing is still required for release builds.
 */

const chromiumGl = {
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...chromiumGl },
    },
    {
      name: 'ipad-landscape-chromium',
      use: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, ...chromiumGl },
    },
    {
      name: 'ipad-portrait-chromium',
      use: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false, ...chromiumGl },
    },
    ...(process.env.PW_WEBKIT
      ? [{ name: 'ipad-webkit', use: { ...devices['iPad Pro 11 landscape'] } }]
      : []),
  ],
});
