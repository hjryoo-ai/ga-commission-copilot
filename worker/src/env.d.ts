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
    /** 설계서 §6.2 3순위 폴백 — OpenRouter 무료 라우터(v0.1.27) */
    OPENROUTER_API_KEY?: string;
    /** 설계서 v0.1.29 §9 — Turnstile Siteverify 비밀(없으면 사람 확인을 검사하지 않는다) */
    TURNSTILE_SECRET?: string;
    /** 설계서 v0.1.35 — 로컬 재현 전용(wrangler.jsonc env.record, 기본 "0"): "1"이면 Groq를 부르지 않고 429. TURNSTILE_SECRET이 있으면 무시 */
    FAKE_GROQ_429?: string;
  }
}

// prompts/**/v*.md는 텍스트 모듈(wrangler rules Text · vitest 설정의 같은 변환 — llm/promptRegistry.ts)
declare module "*.md" {
  const text: string;
  export default text;
}
// evals/cases.jsonl(골든 — 동결)도 텍스트 모듈 — api/evals.ts가 질문 문장을 읽는다
declare module "*.jsonl" {
  const text: string;
  export default text;
}
interface Env {
  SESSION_SECRET?: string;
  POLICY_KEY_SECRET?: string;
  GROQ_API_KEY?: string;
  LLM_TRACE?: string;
  OPENROUTER_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  FAKE_GROQ_429?: string;
}
