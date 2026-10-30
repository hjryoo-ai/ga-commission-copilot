// Phase 2 항목 6: Playwright 3명 × 3화면. wrangler dev(로컬 D1 활성 스트림 + web/dist 정적 자산)를 띄워 같은 출처로 돈다.
// 사용: pnpm run e2e (vite build 뒤 playwright test). 로컬 D1에 스트림이 적재돼 있어야 한다(gen: pnpm run load:d1 -- --local).
import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm --dir ../worker exec wrangler dev --port ${PORT} --local`,
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
