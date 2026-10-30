import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // AI·Vectorize는 원격 전용 바인딩이다. 테스트는 계정·무료 한도를 쓰지 않는다.
        remoteBindings: false,
        // 시험용 시크릿 값(실제 비밀 아님 — 설계서 v0.1.12 §7 세션·policyKey HMAC)
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: "test-session-secret-0123456789abcdef", POLICY_KEY_SECRET: "test-policy-key-secret-0123456789" } },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
