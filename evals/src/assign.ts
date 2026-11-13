// 케이스 → 공급자 배정(설계서 v0.1.37 주간 방식 Groq 50 + Workers AI 60, 운영자 2026-11-14).
// 기준선 런은 순서대로 Groq가 앞 29건(라인·한도)을 맡아 모델 비교가 문항 유형과 섞였다 → 유형(bucket)마다 상한 비율대로 번갈아 배정한다.
// 결정론: 같은 케이스 목록·상한·offset이면 같은 배정. offset(0·1)을 주마다 바꾸면 같은 문항이 두 모델을 번갈아 거친다.
import type { EvalCase } from "./score";

export type ProviderSlot = "groq" | "workers-ai";

export interface Slot {
  c: EvalCase;
  mode: "normal" | "rulesUnavailable";
}

/**
 * 상한이 한쪽만 있으면 전부 그쪽. 둘 다 있으면 유형(모드별로 따로)마다 Groq 몫 = groq ÷ (groq + workers-ai)를
 * 누적 오차(Bresenham) 방식으로 섞어 배정 — 유형 안에서 두 공급자가 번갈아 나오고, 유형별 Groq 비율이 상한 비율에 가깝다.
 */
export function assignProviders(slots: readonly Slot[], caps: Record<ProviderSlot, number>, offset = 0): ProviderSlot[] {
  if (caps["workers-ai"] <= 0) return slots.map(() => "groq");
  if (caps.groq <= 0) return slots.map(() => "workers-ai");
  const share = caps.groq / (caps.groq + caps["workers-ai"]);
  const acc = new Map<string, number>();
  return slots.map((s) => {
    const key = `${s.mode}:${s.c.bucket}`;
    // offset k면 유형마다 배정 무늬를 k칸 민다(같은 문항이 주마다 다른 공급자를 거치게)
    const a = (acc.get(key) ?? (0.5 + offset * share) % 1) + share;
    if (a >= 1) {
      acc.set(key, a - 1);
      return "groq";
    }
    acc.set(key, a);
    return "workers-ai";
  });
}

/** ISO 주 번호의 홀짝 — 주간 런이 주마다 offset을 바꾸게. */
export function weekParity(d: Date): 0 | 1 {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return (week % 2) as 0 | 1;
}
