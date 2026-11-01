// 시크릿(CLAUDE.md 규약 10 — .dev.vars·wrangler secret). wrangler types는 .dev.vars가 없는 곳(CI)에서 이 이름들을 만들지 않으므로 여기서 선언한다.
declare namespace Cloudflare {
  interface Env {
    /** 설계서 v0.1.12 §7 — 세션 쿠키 HMAC */
    SESSION_SECRET?: string;
    /** 설계서 v0.1.12 §7 — policyKey HMAC */
    POLICY_KEY_SECRET?: string;
    /** 설계서 §4.3·§10.2 — 런타임 답변 1순위 Groq(Phase 4: Groq만) */
    GROQ_API_KEY?: string;
    /** 로컬 녹화 전용(.dev.vars) — "1"이면 llm_trace에 원문을 쓴다. wrangler.jsonc vars에 두지 않는다 */
    LLM_TRACE?: string;
    /** 개발용 /me/ask 하루 하드 상한(기본 20 — Phase 4, 예산은 Phase 5) */
    ASK_DAILY_CAP?: string;
  }
}

// prompts/**/v*.md는 텍스트 모듈(wrangler rules Text · vitest 설정의 같은 변환 — llm/promptRegistry.ts)
declare module "*.md" {
  const text: string;
  export default text;
}
interface Env {
  SESSION_SECRET?: string;
  POLICY_KEY_SECRET?: string;
  GROQ_API_KEY?: string;
  LLM_TRACE?: string;
  ASK_DAILY_CAP?: string;
}
