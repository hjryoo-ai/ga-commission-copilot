import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      // wrangler rules의 Text 모듈(*.md)과 같게 — 프롬프트 파일을 문자열 기본 내보내기로
      { name: "md-text", transform: (code: string, id: string) => (id.endsWith(".md") ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined) },
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // AI·Vectorize는 원격 전용 바인딩이다. 테스트는 계정·무료 한도를 쓰지 않는다.
        remoteBindings: false,
        // 시험용 시크릿 값(실제 비밀 아님 — 설계서 v0.1.12 §7 세션·policyKey HMAC). 공급자 키도 가짜로 고정한다:
        // .dev.vars(로컬에만 있음)의 진짜 키에 따라 예산 상한(withKeys)이 달라져 로컬은 통과·CI는 실패하던 것(2026-11-07 CI — /me DEGRADED)을 막고,
        // 시험이 실수로 공급자를 불러도 진짜 키가 나가지 않게.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-session-secret-0123456789abcdef",
            POLICY_KEY_SECRET: "test-policy-key-secret-0123456789",
            GROQ_API_KEY: "test-groq-key-not-real",
            OPENROUTER_API_KEY: "test-openrouter-key-not-real",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
