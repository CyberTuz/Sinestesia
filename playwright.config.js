// The browser tests (test/e2e): a real Chromium plays the page served by our own server.
// Run with `npm run test:e2e`; the first time, `npx playwright install chromium` fetches the browser.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3123;

export default defineConfig({
    testDir: 'test/e2e',
    // each story chapter waits for her lines and for whole bars of music
    timeout: 150_000,
    expect: { timeout: 30_000 },
    fullyParallel: true,
    workers: 3,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /phone/ },
        { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone/ }
    ],
    webServer: {
        command: 'node server/server.js',
        url: `http://127.0.0.1:${PORT}/healthz`,
        env: { PORT: String(PORT) },
        reuseExistingServer: false
    }
});
