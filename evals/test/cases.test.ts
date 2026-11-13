// PHASES Phase 6 항목 1 — 골든 60문항(설계서 §13.2·v0.1.37) 구성·계약·표본 검사. LLM 호출 없음.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");
const cases = readFileSync(join(root, "evals/cases.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case);
const schema = JSON.parse(readFileSync(join(root, "contracts/eval/v1/case.schema.json"), "utf8")) as object;
const sample = JSON.parse(readFileSync(join(root, "evals/pr-sample.json"), "utf8")) as { fixed: string[]; stratified: Record<string, string[]> };
const golden = readFileSync(join(root, "evals/GOLDEN-REVIEW.md"), "utf8");
const reviewed = new Set([...golden.matchAll(/^\| ((?:A|G)-\d{2}) \|/gm)].map((m) => m[1]!));
const appendix = (JSON.parse(readFileSync(join(root, "gen/scripts/appendix-a.json"), "utf8")) as { cases: { case: string; question: string }[] }).cases;

interface Case {
  id: string;
  demoAgent: 1 | 2 | 3;
  agentId: string;
  bucket: "line" | "limit" | "deferral" | "rule" | "refusal";
  question: string;
  expectedTools: { tool: string; args: Record<string, string> }[];
  expectedFacts: { fact: string; match: string[]; source: string }[];
  expectRefusal: boolean;
  expectReason: string | null;
  misleading: boolean;
  forbidden: string[];
  tags: string[];
  modes: string[];
  coreFacts?: number;
}

const count = (xs: readonly string[]) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

describe("골든 60문항(evals/cases.jsonl)", () => {
  it("계약(contracts/eval/v1/case.schema.json)을 모두 통과, id는 A-01~A-12·G-13~G-60 순서대로", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    for (const c of cases) expect(validate(c), `${c.id} ${JSON.stringify(validate.errors)}`).toBe(true);
    expect(cases.map((c) => c.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `A-${String(i + 1).padStart(2, "0")}`), ...Array.from({ length: 48 }, (_, i) => `G-${i + 13}`)]);
  });

  it("구성(§13.2): 라인 15·한도 12·분급 8·규정 10·거부 15, 오답 유도 8(모두 비거부)", () => {
    expect(count(cases.map((c) => c.bucket))).toEqual({ line: 15, limit: 12, deferral: 8, rule: 10, refusal: 15 });
    const misleading = cases.filter((c) => c.misleading);
    expect(misleading).toHaveLength(8);
    expect(misleading.every((c) => !c.expectRefusal && c.forbidden.length > 0)).toBe(true);
  });

  it("거부 15건은 사유 코드가 모델 쪽 3종(BUDGET·PROVIDER_ERROR·NOT_GROUNDED는 기대값이 아니다), 비거부는 핵심 사실 3개 이상", () => {
    for (const c of cases) {
      expect(c.expectRefusal, c.id).toBe(c.bucket === "refusal");
      if (c.expectRefusal) expect(["OUT_OF_SCOPE", "OTHER_AGENT", "NEEDS_ENGINE"], c.id).toContain(c.expectReason);
      else {
        expect(c.expectReason, c.id).toBeNull();
        expect(c.expectedFacts.length, c.id).toBeGreaterThanOrEqual(c.coreFacts ?? 3);
        if (c.coreFacts !== undefined) expect(c.id === "A-12" || reviewed.has(c.id), `${c.id}: coreFacts는 부록 A(A-12) 또는 골든 점검(GOLDEN-REVIEW.md)에 사유가 있는 케이스만`).toBe(true);
      }
    }
  });

  it("부록 A 12건은 데모 설계사 1의 질문 그대로(gen/scripts/appendix-a.json), 데모 번호와 설계사가 맞는다", () => {
    for (const a of appendix) expect(cases.find((c) => c.id === a.case)?.question, a.case).toBe(a.question);
    for (const c of cases) expect(c.agentId, c.id).toBe(`A-100${c.demoAgent}`);
  });

  it("운영자 지정 평가 항목이 케이스로 있다(2026-11-11): 관계 오류·재산정·음수 잔여·MONTH_DIFF·rulesUnavailable·삭감 vs 이연", () => {
    const tagged = (t: string) => cases.filter((c) => c.tags.includes(t)).map((c) => c.id);
    expect(tagged("relation").length).toBeGreaterThanOrEqual(2);
    expect(tagged("rebase_vs_post").length).toBeGreaterThanOrEqual(2);
    expect(tagged("negative_remaining").length).toBeGreaterThanOrEqual(1);
    expect(tagged("MONTH_DIFF").length).toBeGreaterThanOrEqual(3);
    expect(tagged("cut_vs_defer")).toContain("A-01");
    // 음수 잔여: 부호 붙은 금액은 G4가 부호를 떼므로 forbidden만 잡는다
    for (const id of tagged("negative_remaining").filter((id) => cases.find((c) => c.id === id)!.bucket === "limit")) expect(cases.find((c) => c.id === id)!.forbidden, id).toContain("-60,000");
    const ru = cases.filter((c) => c.modes.includes("rulesUnavailable"));
    expect(ru.filter((c) => c.expectRefusal)).toHaveLength(2);
    expect(ru.filter((c) => !c.expectRefusal)).toHaveLength(2);
    expect(cases.find((c) => c.id === "A-01")!.forbidden).toContain("삭감되");
  });

  it("PR 체크 표본(v0.1.37): 부록 A 12 고정 + 유형별 비례 층화 8 = 20, 층의 케이스는 그 유형", () => {
    expect(sample.fixed).toEqual(cases.filter((c) => c.id.startsWith("A-")).map((c) => c.id));
    const rest = cases.filter((c) => c.id.startsWith("G-"));
    const restByBucket = count(rest.map((c) => c.bucket));
    // 최대 나머지 방식: 8 × (유형 수 ÷ 48)
    const quota = Object.fromEntries(Object.entries(restByBucket).map(([b, n]) => [b, (8 * n) / rest.length]));
    const floors = Object.fromEntries(Object.entries(quota).map(([b, q]) => [b, Math.floor(q)]));
    let left = 8 - Object.values(floors).reduce((a, b) => a + b, 0);
    for (const [b] of Object.entries(quota).sort((x, y) => y[1] - Math.floor(y[1]) - (x[1] - Math.floor(x[1])))) if (left-- > 0) floors[b]! += 1;
    expect(Object.fromEntries(Object.entries(sample.stratified).map(([b, ids]) => [b, ids.length]))).toEqual(floors);
    for (const [b, ids] of Object.entries(sample.stratified)) for (const id of ids) expect(cases.find((c) => c.id === id)?.bucket, id).toBe(b);
    expect([...sample.fixed, ...Object.values(sample.stratified).flat()]).toHaveLength(20);
  });

  it("골든 동결(2026-11-14) — cases.jsonl을 바꾸면 GOLDEN-REVIEW.md 동결 해시와 변경 표를 같이 고친다", () => {
    const hash = createHash("sha256").update(readFileSync(join(root, "evals/cases.jsonl"))).digest("hex");
    expect(golden.match(/동결 해시\(sha256, `evals\/cases.jsonl`\): `([0-9a-f]{64})`/)?.[1]).toBe(hash);
  });
});
