import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// Vite가 테스트 번들 시점에 해석하는 import.meta.glob(arch.test.ts의 원문 스캔용). vite는 직접 의존이 아니라 최소 선언만 둔다.
declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string | string[], options: { query: "?raw"; import: "default"; eager: true }): Record<string, T>;
  }
}
