// 프롬프트 누출 시험(운영자 2026-11-16, 호출 없음): answer/v4·v5 본문(1단계·2단계 구역·규칙의 예시 모두 — frontmatter를 뺀 파일 전체)에 골든 문항이 옮겨 써져 있지 않다.
// 좁히기 문장·예시는 유형으로 쓴다("기간 합계·월 비교·예정액은 툴로 답한다") — 케이스를 옮기지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvalCase } from "../src/score";

const root = join(import.meta.dirname, "../..");
const cases = readFileSync(join(root, "evals/cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as EvalCase);
const PROMPTS = ["answer/v4", "answer/v5"];
const body = (p: string) => readFileSync(join(root, "prompts", `${p}.md`), "utf8").replace(/^---[\s\S]*?---\n/, "");
const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const digitsOf = (s: string) => s.replace(/(\d),(?=\d{3}\b)/g, "$1");

/** 골든 기대 사실(사실 문장·match)의 6자리 이상 숫자(쉼표 제거). */
const amounts = [...new Set(cases.flatMap((c) => c.expectedFacts.flatMap((f) => [f.fact, ...f.match]).flatMap((s) => [...digitsOf(s).matchAll(/\d{6,}/g)].map((m) => m[0]))))];
/** 증권번호 끝 4자리 — 기대 툴 인자 policyNo와 사실 문장의 "NNNN 계약". */
const tails = [
  ...new Set([
    ...cases.flatMap((c) => c.expectedTools.map((t) => t.args.policyNo).filter((x): x is string => !!x).map((p) => p.replace(/\D/g, "").slice(-4))),
    ...cases.flatMap((c) => c.expectedFacts.flatMap((f) => [f.fact, ...f.match]).flatMap((s) => [...s.matchAll(/(?<!\d)(\d{4})(?=\s?계약|번 계약)/g)].map((m) => m[1]!))),
  ]),
];
const agentIds = [...new Set(cases.map((c) => c.agentId))];
/** 골든 기대 툴 인자의 달(ym·from·to) — 예시 툴 호출이 골든 호출을 옮기지 않게(2026-11-19: v5 규칙 4 예가 G-39 인자와 같았다). */
const argMonths = [...new Set(cases.flatMap((c) => c.expectedTools.flatMap((t) => [t.args.ym, t.args.from, t.args.to])).filter((x): x is string => !!x))];

describe.each(PROMPTS)("%s — 골든 누출 없음", (p) => {
  const text = body(p);
  const flat = squash(text);
  const flatDigits = digitsOf(text);

  it("질문 문장(전체)이 없고, 공백을 뺀 12자 이상 연속 일치도 없다", () => {
    const hits: string[] = [];
    for (const c of cases) {
      const q = squash(c.question);
      if (text.includes(c.question)) hits.push(`${c.id} 전체`);
      for (let i = 0; i + 12 <= q.length; i++)
        if (flat.includes(q.slice(i, i + 12))) {
          hits.push(`${c.id} "${q.slice(i, i + 12)}"`);
          break;
        }
    }
    expect(hits).toEqual([]);
  });

  it("기대 사실의 금액(6자리 이상)이 없다", () => {
    expect(amounts.length).toBeGreaterThan(10);
    expect(amounts.filter((a) => new RegExp(`(?<!\\d)${a}(?!\\d)`).test(flatDigits))).toEqual([]);
  });

  it("골든 기대 툴 인자의 달(yyyyMM)이 없다 — 예시 툴 호출 포함", () => {
    expect(argMonths.length).toBeGreaterThan(10);
    expect(argMonths.filter((m) => new RegExp(`(?<!\\d)${m}(?!\\d)`).test(text))).toEqual([]);
  });

  it("골든 증권번호 끝 4자리·데모 설계사 ID가 없다", () => {
    expect(tails.length).toBeGreaterThan(0);
    expect(tails.filter((t) => new RegExp(`(?<!\\d)${t}(?!\\d)`).test(text))).toEqual([]);
    expect(agentIds.filter((id) => text.includes(id))).toEqual([]);
  });
});
