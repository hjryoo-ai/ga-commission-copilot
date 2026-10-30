import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // wrangler dev(기본 8787)의 API로 프록시
    proxy: { "/api": "http://localhost:8787" },
  },
  // e2e/*.e2e.ts는 Playwright가 돈다
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
