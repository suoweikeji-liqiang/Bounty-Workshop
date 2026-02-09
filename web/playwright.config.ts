import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '..',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: true,
      env: {
        APP_DB_PATH: 'data/e2e.db',
        ATTACHMENT_STORAGE_DIR: 'data/e2e-storage',
        ENABLE_BACKGROUND_JOBS: 'false',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      cwd: '.',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:8000',
      },
    },
  ],
})

