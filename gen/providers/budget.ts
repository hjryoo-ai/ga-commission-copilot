// 개발용 실호출 예산(CLAUDE.md: 개발 실호출도 budget_counter(scope=dev)에 집계, 규약 5: D1 단일 UPDATE … WHERE used < ?).
// 원격 D1에 wrangler로 쓴다(로컬 OAuth 또는 CLOUDFLARE_API_TOKEN). 실패한 호출도 RPD를 쓰므로 호출 전에 차감한다.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "./prompt.ts";

const DEFAULT_DEV_CAP = 100;

export function devBudgetCap(): number {
  const v = Number(process.env.BUDGET_DEV ?? DEFAULT_DEV_CAP);
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`BUDGET_DEV ${process.env.BUDGET_DEV}: 양의 정수 아님`);
  return v;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** 1회 차감. 영향 행 0이면 소진 → 오류. 반환값은 차감 뒤 사용량이 아니라 차감 성공 여부(소진 시 throw). */
export function reserveDevCall(now = new Date()): void {
  reserveCall("dev", devBudgetCap(), now);
}

export class BudgetExhausted extends Error {}

const SCOPE = /^[a-z][a-z0-9:_-]{0,63}$/;

/**
 * scope 하루 상한 안에서 1회 차감(설계서 §6.2·v0.1.14 §4.1(b) — 'dev', 'batch:explain:groq' …). 규약 5: UPDATE … WHERE used < ? 한 문장.
 * 영향 행 0이면 BudgetExhausted.
 */
export function reserveCall(scope: string, cap: number, now = new Date()): void {
  if (!SCOPE.test(scope)) throw new Error(`scope ${scope}: 형식 아님`);
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error(`cap ${cap}: 양의 정수 아님`);
  const day = utcDay(now);
  // 값은 코드가 만든 리터럴(검사한 scope·날짜·정수)뿐이다 — 외부 입력 없음.
  const sql =
    `INSERT OR IGNORE INTO budget_counter (scope, day, used) VALUES ('${scope}', '${day}', 0); ` +
    `UPDATE budget_counter SET used = used + 1 WHERE scope = '${scope}' AND day = '${day}' AND used < ${cap};`;
  const out = execFileSync(
    "pnpm",
    ["--dir", join(REPO_ROOT, "worker"), "exec", "wrangler", "d1", "execute", "copilot", "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const results = JSON.parse(out) as { meta?: { changes?: number } }[];
  const changes = results.at(-1)?.meta?.changes;
  if (changes !== 1) throw new BudgetExhausted(`예산 소진(scope=${scope}, day=${day}, cap=${cap}) — 실호출 중단`);
}
