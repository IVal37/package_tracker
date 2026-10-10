import { defineConfig, devices } from "@playwright/test";
import { APP_PORT, APP_URL, FAKE_AUTH_PORT, appEnv } from "./e2e/env";

// The launch test: `npm run e2e`. A production build of the app against a
// test database and the fake auth server (see e2e/env.ts).
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // MapLibre needs WebGL; headless Chromium draws it in software.
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/fake-auth/server.mjs",
      url: `http://127.0.0.1:${FAKE_AUTH_PORT}/auth/v1/.well-known/jwks.json`,
      env: { FAKE_AUTH_PORT: String(FAKE_AUTH_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npm run build && npx next start -p ${APP_PORT}`,
      url: `${APP_URL}/sign-in`,
      env: appEnv(),
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
