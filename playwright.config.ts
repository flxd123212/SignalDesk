import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 8000 },
  use: { baseURL: 'http://127.0.0.1:4788', channel: 'msedge', headless: true, viewport: { width: 1500, height: 950 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/ui-server.mjs', url: 'http://127.0.0.1:4788/api/state', reuseExistingServer: false, timeout: 30000 },
  reporter: 'list',
});
