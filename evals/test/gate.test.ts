// PHASES Phase 6 항목 4 — 프롬프트 승격 관문(설계서 §6.3·§13.1). LLM 호출 없음.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { gate, refQuery, refSummary } from "../src/gate";
import type { RunSummary, Thresholds } from "../src/score";

const t: Thresholds = { grounding: 90, refusal: 80, tool: 85, content: 70, maxDropPp: 3 };
const ax = (pass: number, n: number) => ({ n, pass, rate: n ? Math.round((pass * 10000) / n) / 100 : null });
const sum = (g: number, r: number, tl: number, c: number): RunSummary => ({ total: 20, passed: 15, grounding: ax(g, 15), refusal: ax(r, 20), tool: ax(tl, 14), content: ax(c, 15), meanLatencyMs: 1000 });
const meta = { runId: "r", promptVersions: "answer=v3" };

describe("gate", () => {
  it("임계치 이상이고 기준 런이 없으면 통과", () => {
    const r = gate(sum(15, 20, 14, 15), t, null, meta);
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain("직전 활성 기준 없음");
  });

  it("임계치 미달은 실패", () => {
    const r = gate(sum(15, 20, 14, 10), t, null, meta);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("내용 일치 66.67% < 임계치 70%");
  });

  it("직전 대비 한 축이라도 3%p 이상 하락하면 실패 — 20문항 표본에서는 한 건", () => {
    const r = gate(sum(15, 20, 13, 15), t, sum(15, 20, 14, 15), { ...meta, refRunId: "ref" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain("툴 정확도 직전 대비 -7.14%p");
  });

  it("그라운딩·거부는 직전 이상(§6.3) — 3%p 미만 하락도 실패", () => {
    const big = (g: number) => ({ ...sum(15, 20, 14, 15), grounding: ax(g, 100) });
    const r = gate(big(98), t, big(99), { ...meta, refRunId: "ref" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain("그라운딩 통과율 직전 활성 버전 미만");
  });

  it("공급자 오류·미실행이 있으면 판정 불가 = 실패", () => {
    expect(gate({ ...sum(15, 20, 14, 15), errors: 1 }, t, null, meta).ok).toBe(false);
  });

  it("기준 런 행에서 표본 케이스의 normal 모드만 다시 센다", () => {
    const row = (id: string, grounding: boolean | null) => ({ case_id: id, actual: JSON.stringify({ caseId: id, mode: "normal", latencyMs: 10, score: { grounding, refusal: true, tool: null, content: null, passed: grounding !== false, failureKind: null, missingFacts: [], forbiddenHits: [] } }) });
    const s = refSummary([row("A-01", true), row("A-02", false), row("A-02#rulesUnavailable", true), row("G-01", false)], ["A-01", "A-02"]);
    expect(s.total).toBe(2);
    expect(s.grounding).toEqual({ n: 2, pass: 1, rate: 50 });
  });
});

describe("refQuery — 직전 활성 기준은 60문항 런(baseline·weekly)만", () => {
  const PV = "explain_line=v6,answer=v3,schema_hint=v1";
  const PVJ = JSON.stringify({ explain_line: "v6", answer: "v3", schema_hint: "v1" });
  const db = () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE eval_run (run_id TEXT, started_at TEXT, trigger TEXT, prompt_versions TEXT, total INTEGER); CREATE TABLE eval_case_result (run_id TEXT, case_id TEXT, actual TEXT)");
    const run = d.prepare("INSERT INTO eval_run VALUES (?,?,?,?,?)");
    const row = d.prepare("INSERT INTO eval_case_result VALUES (?,?,?)");
    const add = (id: string, at: string, trigger: string, total: number, pv = PVJ) => {
      run.run(id, at, trigger, pv, total);
      for (let i = 0; i < Math.min(total, 3); i++) row.run(id, `A-0${i + 1}`, "{}");
    };
    add("base", "2026-11-13T22:56:38Z", "baseline", 60);
    add("var1", "2026-11-15T00:10:00Z", "variance:2026-11-15", 12);
    add("pr7", "2026-11-16T00:10:00Z", "pr:7", 20);
    add("other-pv", "2026-11-17T00:10:00Z", "weekly", 60, JSON.stringify({ answer: "v4" }));
    return { d, add };
  };
  const pick = (d: DatabaseSync) => [...new Set((d.prepare(refQuery(PV)).all() as { run_id: string }[]).map((r) => r.run_id))];

  it("variance·pr 런이 더 늦어도 기준선을 고른다(같은 PROMPT_VERSIONS)", () => {
    expect(pick(db().d)).toEqual(["base"]);
  });

  it("같은 버전의 weekly가 나중에 있으면 그것", () => {
    const { d, add } = db();
    add("wk", "2026-11-22T03:00:00Z", "weekly", 60);
    expect(pick(d)).toEqual(["wk"]);
  });

  it("60건이 안 되는 weekly(상한 미달로 끊긴 런 등)는 기준이 아니다", () => {
    const { d, add } = db();
    add("wk-short", "2026-11-22T03:00:00Z", "weekly", 40);
    expect(pick(d)).toEqual(["base"]);
  });

  it("PROMPT_VERSIONS 형식이 아니면 SQL을 만들지 않는다", () => {
    expect(() => refQuery("answer=v3' OR 1=1 --")).toThrow("형식");
  });
});
