import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 60000, workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 960 } } },
    { name: 'WebKit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 960 } } },
  ],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true, timeout: 30000 },
});
