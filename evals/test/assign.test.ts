// 공급자 배정(운영자 2026-11-14 — 주간 60문항 런은 유형별로 번갈아, 앞 N건 몰아주기 금지). LLM 호출 없음.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignProviders, type Slot, weekParity } from "../src/assign";
import type { EvalCase } from "../src/score";

const cases = readFileSync(join(import.meta.dirname, "../cases.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EvalCase);
const slots: Slot[] = (["normal", "rulesUnavailable"] as const).flatMap((mode) => cases.filter((c) => c.modes.includes(mode)).map((c) => ({ c, mode })));
const weekly = { groq: 50, "workers-ai": 60 };

describe("assignProviders", () => {
  it("한쪽 상한만 있으면 전부 그쪽(PR·variance = Groq 단독)", () => {
    expect(new Set(assignProviders(slots, { groq: 24, "workers-ai": 0 }))).toEqual(new Set(["groq"]));
    expect(new Set(assignProviders(slots, { groq: 0, "workers-ai": 60 }))).toEqual(new Set(["workers-ai"]));
  });

  it("주간 방식: 유형마다 두 공급자가 다 있고 Groq 비율이 상한 비율(50/110)에서 1건 안", () => {
    const a = assignProviders(slots, weekly);
    for (const b of ["line", "limit", "deferral", "rule", "refusal"]) {
      const idx = slots.flatMap((s, i) => (s.mode === "normal" && s.c.bucket === b ? [i] : []));
      const g = idx.filter((i) => a[i] === "groq").length;
      expect(g, b).toBeGreaterThan(0);
      expect(idx.length - g, b).toBeGreaterThan(0);
      expect(Math.abs(g - (idx.length * 50) / 110), b).toBeLessThan(1);
    }
  });

  it("앞 N건 몰아주기가 아니다 — 처음 10건 안에 두 공급자가 섞인다", () => {
    expect(new Set(assignProviders(slots, weekly).slice(0, 10)).size).toBe(2);
  });

  it("Groq 몫 호출이 상한 안: 2호출 × Groq 배정 ≤ 50 + 거부 1호출 여유", () => {
    const g = assignProviders(slots, weekly).filter((x) => x === "groq").length;
    expect(g * 2).toBeLessThanOrEqual(60);
  });

  it("결정론이고, offset을 바꾸면 배정 무늬가 달라진다", () => {
    expect(assignProviders(slots, weekly, 0)).toEqual(assignProviders(slots, weekly, 0));
    const a0 = assignProviders(slots, weekly, 0);
    const a1 = assignProviders(slots, weekly, 1);
    expect(a0.filter((x, i) => x !== a1[i]).length).toBeGreaterThan(slots.length / 4);
  });

  it("weekParity — ISO 주 홀짝", () => {
    expect(weekParity(new Date("2026-11-14T00:00:00Z"))).toBe(46 % 2);
    expect(weekParity(new Date("2026-11-16T00:00:00Z"))).toBe(47 % 2);
  });
});
