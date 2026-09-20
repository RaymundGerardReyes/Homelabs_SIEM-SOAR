import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: 2,
  workers: 4,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost', // Nginx proxy URL
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
