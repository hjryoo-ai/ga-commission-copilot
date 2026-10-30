// 시크릿(CLAUDE.md 규약 10 — .dev.vars·wrangler secret). wrangler types는 .dev.vars가 없는 곳(CI)에서 이 이름들을 만들지 않으므로 여기서 선언한다.
declare namespace Cloudflare {
  interface Env {
    /** 설계서 v0.1.12 §7 — 세션 쿠키 HMAC */
    SESSION_SECRET?: string;
    /** 설계서 v0.1.12 §7 — policyKey HMAC */
    POLICY_KEY_SECRET?: string;
  }
}
interface Env {
  SESSION_SECRET?: string;
  POLICY_KEY_SECRET?: string;
}
