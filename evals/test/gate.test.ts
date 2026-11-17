// PHASES Phase 6 항목 4 — 프롬프트 승격 관문(설계서 §6.3·§13.1 v0.1.46: 케이스별 기준 · R1 축별 1건분 허용 · R2 안정 케이스 · R3 오류). LLM 호출 없음.
// 고정 자료: 부록 A 12건 normal 점수 — r1(60문항 재채점)과 n=3 세 런(2026-11-16-a · -b · 11-17), evals/test/fixtures/appendix-a-n3.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type Axis, buildReference, gate, type RefCaseRow, refQuery } from "../src/gate";
import type { CaseScore, Thresholds } from "../src/score";

type FxRun = { runId: string; trigger: string; startedAt: string; total: number; cases: Record<string, CaseScore> };
const fx = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/appendix-a-n3.json"), "utf8")) as { runs: FxRun[] };
const [r1, a, b, c] = fx.runs as [FxRun, FxRun, FxRun, FxRun];
const ids = Object.keys(r1.cases).sort();
const t: Thresholds = { grounding: 52.2, refusal: 80.3, tool: 63.6, content: 25.8 };
const meta = { runId: "x", promptVersions: "answer=v3" };

const rowsOf = (r: FxRun, as?: { trigger: string; total: number }): RefCaseRow[] =>
  ids.map((id) => ({ run_id: r.runId, trigger: as?.trigger ?? r.trigger, started_at: r.startedAt, total: as?.total ?? r.total, case_id: id, score: JSON.stringify(r.cases[id]), error: null }));
const cand = (cases: Record<string, CaseScore>) => ids.map((id) => ({ caseId: id, score: cases[id]! }));
/** 한 런을 60문항 런 기준으로(케이스 자료 1회 — 과반 없음). */
const single = (r: FxRun) => buildReference(rowsOf(r, { trigger: "weekly", total: 60 }), ids);
const majority = buildReference([a, b, c].flatMap((r) => rowsOf(r)), ids);

describe("기준(v0.1.46 — 케이스별 최근 3회 과반, 모자라면 60문항 런)", () => {
  it("n=3 세 런의 과반: 안정 케이스(3회 모두 통과)는 A-04 · A-08~A-12, 통과 과반 7/12", () => {
    expect([...majority.values()].filter((x) => x.stable).map((x) => x.caseId)).toEqual(["A-04", "A-08", "A-09", "A-10", "A-11", "A-12"]);
    expect([...majority.values()].filter((x) => x.passed).length).toBe(7);
    expect(majority.get("A-02")).toMatchObject({ source: "majority", passed: true, stable: false });
  });

  it("r1이 함께 있어도 케이스별 최근 3회(n=3 세 런)를 쓴다", () => {
    const four = buildReference([r1, a, b, c].flatMap((r) => rowsOf(r)), ids);
    expect(four.get("A-01")!.runs).toEqual([c.runId, b.runId, a.runId]);
  });

  it("3회가 안 되는 케이스는 그 버전의 최신 60문항 런(재채점이 있으면 재채점) — 원본·옛 재채점은 세지 않는다", () => {
    const orig = rowsOf(r1, { trigger: "baseline", total: 60 }).map((x) => ({ ...x, run_id: "20261113T225638-baseline", score: JSON.stringify({ ...r1.cases[x.case_id], passed: false }) }));
    const old = rowsOf(r1).map((x) => ({ ...x, run_id: "20261113T225638-baseline-r0" }));
    const refs = buildReference([...orig, ...old, ...rowsOf(r1), ...rowsOf(a)], ids);
    expect(refs.get("A-04")).toMatchObject({ source: r1.runId, stable: false, passed: true });
  });

  it("동수(값이 있는 2회가 1:1)는 미통과", () => {
    const two = (v: boolean | null) => ({ ...a.cases["A-07"]!, grounding: v });
    const rows = [two(true), two(false), two(null)].map((s, i) => ({ run_id: `v${i}`, trigger: "variance:x", started_at: `2026-11-1${i}`, total: 12, case_id: "A-07", score: JSON.stringify(s), error: null }));
    expect(buildReference(rows, ["A-07"]).get("A-07")!.axes.grounding).toBe(false);
  });

  it("오류·미실행 행은 기준 실행으로 세지 않는다", () => {
    const rows = [...rowsOf(a), ...rowsOf(b), ...rowsOf(c).map((x) => ({ ...x, error: "예산(eval 상한) — 미실행" }))];
    expect(buildReference(rows, ids).size).toBe(0);
  });
});

describe("같은 버전 런끼리 — 거짓 실패(운영자 2026-11-17 확인 표)", () => {
  const runs = { r1, a, b, c };
  const pairs = Object.entries(runs).flatMap(([na, ra]) => Object.entries(runs).filter(([nb]) => nb !== na).map(([nb, rb]) => ({ pair: `${na}→${nb}`, ok: gate(cand(rb.cases), single(ra), t, meta).ok })));

  it("한 런 기준 12쌍: 실패 4쌍 — a→r1 · b→r1 · c→r1 · a→c(내용 5→3), n=3끼리는 1/6", () => {
    expect(pairs.filter((p) => !p.ok).map((p) => p.pair)).toEqual(["a→r1", "a→c", "b→r1", "c→r1"]);
  });

  it("n=3 과반 기준 → n=3 세 런은 모두 통과, r1(11-13 표본, 통과 5/12)은 R1 세 축으로 실패", () => {
    for (const r of [a, b, c]) expect(gate(cand(r.cases), majority, t, meta).ok, r.trigger).toBe(true);
    const g = gate(cand(r1.cases), majority, t, meta);
    expect(g.ok).toBe(false);
    expect(g.axes.filter((x) => x.drop >= 2).map((x) => x.axis)).toEqual(["grounding", "tool", "content"]);
    expect(g.stableFailed).toEqual(["A-12"]);
  });

  it("R1 건수는 기준 케이스 집합 D_k에서 센다 — 2일차 툴 7→6/7(1건분 → 통과, 율 반올림과 무관)", () => {
    const g = gate(cand(b.cases), majority, t, meta);
    expect(g.axes.find((x) => x.axis === "tool")).toMatchObject({ d: 7, ref: 7, cur: 6, drop: 1 });
    expect(g.ok).toBe(true);
  });
});

describe("가상 열화 런(과반 기준 대비)", () => {
  /** 과반 값을 그대로 낸 런에서 몇 칸만 바꾼다. */
  const base = (): Record<string, CaseScore> => Object.fromEntries(ids.map((id) => {
    const m = majority.get(id)!;
    return [id, { ...m.axes, passed: m.passed, failureKind: null, missingFacts: [], forbiddenHits: [] } as CaseScore];
  }));
  const set = (s: Record<string, CaseScore>, id: string, axis: Axis) => (s[id] = { ...s[id]!, [axis]: false, passed: false });

  it("그대로면 통과", () => {
    expect(gate(cand(base()), majority, t, meta).ok).toBe(true);
  });

  it("안정 케이스 2건 실패(서로 다른 축 1건씩) → R2로 실패", () => {
    const s = base();
    set(s, "A-08", "content");
    set(s, "A-10", "refusal");
    const g = gate(cand(s), majority, t, meta);
    expect(g.ok).toBe(false);
    expect(g.reasons).toEqual([expect.stringContaining("R2 안정 케이스 2/6건 실패: A-08, A-10")]);
  });

  it("한 축 2건 하락(안정 케이스 아님) → R1로 실패", () => {
    const s = base();
    set(s, "A-01", "grounding");
    set(s, "A-03", "grounding");
    const g = gate(cand(s), majority, t, meta);
    expect(g.ok).toBe(false);
    expect(g.reasons).toEqual([expect.stringContaining("R1 그라운딩 통과율 기준 8/9 → 이번 6/9")]);
  });

  it("두 축에 1건씩(안정 케이스 아님) → 통과 — 이 관문이 못 잡는 크기(알려진 한계)", () => {
    const s = base();
    set(s, "A-01", "grounding");
    set(s, "A-03", "tool");
    expect(gate(cand(s), majority, t, meta).ok).toBe(true);
  });

  it("R3: 오류·미실행이 있으면 판정 불가 = 실패", () => {
    const rows = cand(base());
    rows[0] = { ...rows[0]!, error: "ProvidersFailed" } as (typeof rows)[number];
    expect(gate(rows, majority, t, meta).reasons[0]).toContain("R3");
  });

  it("절대 관문값은 PR 표본(20건)에 적용하지 않고, 60문항 런에서는 미달을 표시만 한다", () => {
    const low = { total: 20, passed: 5, grounding: { n: 9, pass: 2, rate: 22.22 }, refusal: { n: 12, pass: 12, rate: 100 }, tool: { n: 7, pass: 7, rate: 100 }, content: { n: 9, pass: 2, rate: 22.22 }, meanLatencyMs: 1 };
    expect(gate(cand(base()), majority, t, { ...meta, summary: low }).belowThresholds).toEqual([]);
    const g = gate(cand(base()), majority, t, { ...meta, summary: { ...low, total: 60 } });
    expect(g.belowThresholds).toEqual(["그라운딩 통과율 22.22% < 관문값 52.2%", "내용 일치 22.22% < 관문값 25.8%"]);
    expect(g.ok).toBe(true);
  });
});

describe("refQuery — 같은 버전의 60문항·재채점·variance·pr 런의 normal 케이스", () => {
  const PV = "explain_line=v6,answer=v3,schema_hint=v1";
  const PVJ = JSON.stringify({ explain_line: "v6", answer: "v3", schema_hint: "v1" });
  const db = () => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE eval_run (run_id TEXT, started_at TEXT, trigger TEXT, prompt_versions TEXT, total INTEGER); CREATE TABLE eval_case_result (run_id TEXT, case_id TEXT, actual TEXT)");
    const run = d.prepare("INSERT INTO eval_run VALUES (?,?,?,?,?)");
    const row = d.prepare("INSERT INTO eval_case_result VALUES (?,?,?)");
    const add = (id: string, at: string, trigger: string, total: number, pv = PVJ) => {
      run.run(id, at, trigger, pv, total);
      row.run(id, "A-01", JSON.stringify({ caseId: "A-01", mode: "normal", text: "본문", score: { passed: true } }));
      row.run(id, "A-04#rulesUnavailable", JSON.stringify({ score: { passed: false } }));
    };
    add("base", "2026-11-13T22:56:38Z", "baseline", 60);
    add("base-r1", "2026-11-13T22:56:38Z", "rescore:baseline", 60);
    add("var1", "2026-11-16T10:40:00Z", "variance:2026-11-16-a", 12);
    add("pr7", "2026-11-18T00:10:00Z", "pr:7", 20);
    add("man", "2026-11-18T01:00:00Z", "manual", 12);
    add("other-pv", "2026-11-19T00:10:00Z", "weekly", 60, JSON.stringify({ answer: "v4" }));
    return d;
  };

  it("같은 PROMPT_VERSIONS만, manual·다른 버전 제외, rulesUnavailable 행 제외, 최근 순, 점수만(본문 없음)", () => {
    const rows = db().prepare(refQuery(PV)).all() as unknown as RefCaseRow[];
    expect(rows.map((r) => r.run_id)).toEqual(["pr7", "var1", "base-r1", "base"]);
    expect(rows.every((r) => r.case_id === "A-01")).toBe(true);
    expect(JSON.parse(rows[0]!.score!)).toEqual({ passed: true });
    expect(Object.keys(rows[0]!)).not.toContain("actual");
  });

  it("PROMPT_VERSIONS 형식이 아니면 SQL을 만들지 않는다", () => {
    expect(() => refQuery("answer=v3' OR 1=1 --")).toThrow("형식");
  });
});
