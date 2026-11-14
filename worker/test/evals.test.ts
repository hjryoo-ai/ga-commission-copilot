import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { validate } from "./contract";

// PHASES Phase 6 항목 5 — GET /api/v1/evals · /evals/{runId}(설계서 §7·§8-5, 공개). 하네스가 적재한 행을 세기만 한다(재채점 없음).
const PV = JSON.stringify({ answer: "v3", schema_hint: "v1" });

const score = (o: Partial<{ grounding: boolean | null; refusal: boolean; tool: boolean | null; content: boolean | null }>) => {
  const s = { grounding: null, refusal: true, tool: null, content: null, ...o };
  const failureKind = s.grounding === false ? "GROUNDING" : !s.refusal ? "REFUSAL" : s.tool === false ? "TOOL" : s.content === false ? "CONTENT" : null;
  return { ...s, passed: failureKind === null, failureKind, missingFacts: s.content === false ? ["사실"] : [], forbiddenHits: [] };
};

async function seedRun(runId: string, startedAt: string, trigger: string, rows: { id: string; bucket: string; provider: string; s: ReturnType<typeof score>; mode?: string }[], pv = PV, excludesWait = false) {
  const normal = rows.filter((r) => !r.mode);
  await env.DB.prepare(
    "INSERT INTO eval_run (run_id, started_at, trigger, prompt_versions, stream_hash, model, total, passed, grounding_pass_rate, refusal_accuracy, tool_accuracy, mean_latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(runId, startedAt, trigger, pv, "h".repeat(64), "groq+workers-ai", normal.length, normal.filter((r) => r.s.passed).length, 0.5, 0.75, null, 1200)
    .run();
  for (const r of rows) {
    const caseId = r.mode ? `${r.id}#${r.mode}` : r.id;
    const actual = { caseId: r.id, mode: r.mode ?? "normal", provider: r.provider, refused: false, reason: null, groundingStatus: r.s.grounding === false ? "FAIL" : "PASS", text: "답".repeat(700), toolCalls: [], latencyMs: 10, ...(excludesWait ? { latencyExcludesWait: true } : {}), score: r.s };
    const expected = { bucket: r.bucket, expectedTools: [], facts: ["사실"], expectRefusal: false, expectReason: null, misleading: false, tags: [] };
    await env.DB.prepare("INSERT INTO eval_case_result (run_id, case_id, passed, expected, actual, failure_kind) VALUES (?,?,?,?,?,?)")
      .bind(runId, caseId, r.s.passed ? 1 : 0, JSON.stringify(expected), JSON.stringify(actual), r.s.failureKind)
      .run();
  }
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM eval_case_result"), env.DB.prepare("DELETE FROM eval_run")]);
});

const get = async (path: string) => {
  const res = await exports.default.fetch(new Request(`https://example.com${path}`));
  return { res, body: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/v1/evals", () => {
  it("빈 표면 runs 빈 배열·variance null, 계약 통과", async () => {
    const { res, body } = await get("/api/v1/evals");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ runs: [], variance: null });
    expect(validate("EvalsResponse", body)).toEqual([]);
  });

  it("최근 런 먼저, 내용 일치율은 케이스 판정에서(normal만), rulesUnavailable은 따로 센다", async () => {
    await seedRun("20261113T225638-baseline", "2026-11-13T22:56:38.000Z", "baseline", [
      { id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: false }) },
      { id: "G-40", bucket: "rule", provider: "workers-ai", s: score({ grounding: true, content: true }) },
      { id: "A-04", bucket: "limit", provider: "workers-ai", s: score({ refusal: false }), mode: "rulesUnavailable" },
    ]);
    await seedRun("20261113T225638-baseline-r1", "2026-11-13T22:56:38.000Z", "rescore:baseline", [
      { id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: true }) },
      { id: "G-40", bucket: "rule", provider: "workers-ai", s: score({ grounding: true, content: true }) },
    ]);
    const { body } = await get("/api/v1/evals");
    expect(validate("EvalsResponse", body)).toEqual([]);
    const runs = body.runs as { runId: string; rates: { content: number | null; refusal: number | null }; rulesUnavailable: { total: number; passed: number } }[];
    expect(runs.map((r) => r.runId)).toEqual(["20261113T225638-baseline-r1", "20261113T225638-baseline"]);
    expect(runs[1]!.rates).toMatchObject({ content: 0.5, refusal: 0.75 });
    expect(runs[1]!.rulesUnavailable).toEqual({ total: 1, passed: 0 });
    expect(runs[0]!.rates.content).toBe(1);
    // 2026-11-14 이전 하네스(대기 포함) — 케이스에 latencyExcludesWait가 없다
    expect((runs[1] as unknown as { latencyIncludesWait: boolean }).latencyIncludesWait).toBe(true);
  });

  it("평균 지연: 하네스가 대기를 뺀 런(케이스 latencyExcludesWait)은 latencyIncludesWait false", async () => {
    await seedRun("20261115T001000-variance-2026-11-15", "2026-11-15T00:10:00.000Z", "variance:2026-11-15", [{ id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: true }) }], PV, true);
    const { body } = await get("/api/v1/evals");
    expect((body.runs as { latencyIncludesWait: boolean }[])[0]!.latencyIncludesWait).toBe(false);
    expect(validate("EvalsResponse", body)).toEqual([]);
  });

  it("n=3 분산: 가장 최근 variance 런과 같은 버전의 최근 3런, 케이스별 통과 횟수·분포(오래된 런부터)", async () => {
    const days = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];
    const a12 = [true, false, true, true];
    for (const [i, d] of days.entries()) {
      await seedRun(`${d.replace(/-/g, "")}T001000-variance-${d}`, `${d}T00:10:00.000Z`, `variance:${d}`, [
        { id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: true }) },
        { id: "A-12", bucket: "line", provider: "groq", s: score({ grounding: a12[i]!, content: true }) },
      ]);
    }
    // 다른 버전의 variance 런은 섞지 않는다
    await seedRun("20261119T001000-variance-2026-11-19", "2026-11-19T00:10:00.000Z", "variance:2026-11-19", [{ id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: false }) }], JSON.stringify({ answer: "v4" }));
    const { body } = await get("/api/v1/evals");
    expect(validate("EvalsResponse", body)).toEqual([]);
    const v = body.variance as { promptVersions: Record<string, string>; runs: { trigger: string }[]; cases: { caseId: string; results: (boolean | null)[]; passes: number; n: number; question: string | null }[]; distribution: Record<string, number> };
    expect(v.promptVersions).toEqual({ answer: "v4" });
    expect(v.cases).toEqual([{ caseId: "A-01", question: "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?", results: [false], passes: 0, n: 1 }]);
  });

  it("n=3 분산: 같은 버전 4런이면 최근 3런만", async () => {
    const days = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];
    const a12 = [true, false, true, true];
    for (const [i, d] of days.entries()) {
      await seedRun(`${d.replace(/-/g, "")}T001000-variance-${d}`, `${d}T00:10:00.000Z`, `variance:${d}`, [
        { id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: true }) },
        { id: "A-12", bucket: "line", provider: "groq", s: score({ grounding: a12[i]!, content: true }) },
      ]);
    }
    const { body } = await get("/api/v1/evals");
    const v = body.variance as { runs: { trigger: string }[]; cases: { caseId: string; results: (boolean | null)[]; passes: number; n: number }[]; distribution: Record<string, number> };
    expect(v.runs.map((r) => r.trigger)).toEqual(["variance:2026-11-16", "variance:2026-11-17", "variance:2026-11-18"]);
    expect(v.cases.find((c) => c.caseId === "A-12")).toMatchObject({ results: [false, true, true], passes: 2, n: 3 });
    expect(v.distribution).toEqual({ "3": 1, "2": 1, "1": 0, "0": 0 });
  });
});

describe("GET /api/v1/evals/{runId}", () => {
  it("실패 우선 표·유형별 통과·모델별 4축·rulesUnavailable 따로, 질문은 골든에서, 본문 600자", async () => {
    await seedRun("20261113T225638-baseline", "2026-11-13T22:56:38.000Z", "baseline", [
      { id: "A-08", bucket: "rule", provider: "groq", s: score({ grounding: true, content: true }) },
      { id: "A-01", bucket: "line", provider: "groq", s: score({ grounding: true, content: false }) },
      { id: "G-40", bucket: "rule", provider: "workers-ai", s: score({ grounding: false }) },
      { id: "A-04", bucket: "limit", provider: "workers-ai", s: score({ refusal: false }), mode: "rulesUnavailable" },
    ]);
    const { res, body } = await get("/api/v1/evals/20261113T225638-baseline");
    expect(res.status).toBe(200);
    expect(validate("EvalRunResponse", body)).toEqual([]);
    const cases = body.cases as { caseId: string; passed: boolean; question: string; text: string }[];
    expect(cases.map((c) => [c.caseId, c.passed])).toEqual([
      ["A-01", false],
      ["G-40", false],
      ["A-08", true],
    ]);
    expect(cases[0]!.question).toBe("8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?");
    expect(cases[0]!.text).toHaveLength(600);
    expect(body.byBucket).toEqual([
      { bucket: "line", total: 1, passed: 0 },
      { bucket: "limit", total: 0, passed: 0 },
      { bucket: "deferral", total: 0, passed: 0 },
      { bucket: "rule", total: 2, passed: 1 },
      { bucket: "refusal", total: 0, passed: 0 },
    ]);
    expect(Object.keys(body.byProvider as object)).toEqual(["groq", "workers-ai"]);
    expect((body.byProvider as Record<string, { grounding: { rate: number } }>)["workers-ai"]!.grounding).toEqual({ n: 1, pass: 0, rate: 0 });
    expect((body.rulesUnavailable as { caseId: string; mode: string }[]).map((c) => [c.caseId, c.mode])).toEqual([["A-04", "rulesUnavailable"]]);
  });

  it("없는 런·형식이 틀린 ID는 404", async () => {
    expect((await get("/api/v1/evals/20261113T225638-nope")).res.status).toBe(404);
    expect((await get("/api/v1/evals/..%2F..%2Fetc")).res.status).toBe(404);
  });

  it("조회 인덱스(0007) — 목록·variance 구간이 eval_run을 풀스캔하지 않는다", async () => {
    const plan = async (sql: string) => JSON.stringify((await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results);
    expect(await plan("SELECT run_id FROM eval_run ORDER BY started_at DESC, run_id DESC LIMIT 12")).toContain("ix_eval_run_started");
    expect(await plan("SELECT run_id FROM eval_run WHERE trigger >= 'variance:' AND trigger < 'variance;' ORDER BY trigger DESC, started_at DESC LIMIT 10")).toContain("ix_eval_run_trigger");
  });
});
