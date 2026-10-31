import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractTokens } from "@copilot/grounding";
import { beforeEach, describe, expect, it } from "vitest";
import { type AgentRows, limitContext, lineContext, monthDiffContext, type Row, subjectsOf } from "../explain/context.ts";
import { type Caller, generateOne, labelOf, promptVersionOf, type Subject } from "../explain/generate.ts";
import { recheckExplanations } from "../explain/recheck.ts";
import { ExplanationStore, recordProblems } from "../explain/store.ts";
import { type D1Exec, loadExplanations, loadSlot, purgeInactive } from "../load/flow.ts";
import { loadMigration } from "../load/sql.ts";
import { parseContent, ProviderError } from "../providers/groq.ts";
import { REPO_ROOT } from "../providers/prompt.ts";
import { classifyError, rejectsResponseFormat, sentenceCount } from "../explain/run.ts";

// PHASES Phase 3 항목 2·3·4(설계서 v0.1.14 §4.1(b)·§5.4): 컨텍스트 빌더, 재생성 1회, 저장 G1, 적재(없는 키만), 적재 후 전수 재검증.
// 행은 부록 A-1 정본 값(월납 150,000·한도 1,800,000·FY 945,000·시책 855,000 + 삭감 145,000·해약 환수 −720,000).
const HASH = "a".repeat(64);
const line = (calc_id: string, comm_type: string, amount: number, close_ym: string, source_seq: number, extra: Row = {}): Row => ({
  agent_id: "A-1001",
  calc_id,
  policy_no: "POL-2026-0001",
  product_key: "WHOLE-LIFE-20Y",
  comm_type,
  amount,
  close_ym,
  limit_cut_amt: 0,
  limit_cut_policy: null,
  reversal_of_calc_id: null,
  basis: { rate: "7", payoutRate: "0.9" },
  policy_summary: { contractDate: "2026-08-01", monthlyPremium: 150000 },
  source_seq,
  ...extra,
});
const A1: AgentRows = {
  agentId: "A-1001",
  earnings_line: [
    line("1", "FY_COMM", 945000, "202608", 2),
    line("2", "INCENTIVE", 855000, "202608", 3, { limit_cut_amt: 145000, limit_cut_policy: "DEFER_AFTER_FY", basis: { rate: "1" } }),
    line("6", "CLAWBACK", -720000, "202702", 9, { basis: { rate: "0.4", installmentNo: 7 } }),
  ],
  earnings_month: [
    { agent_id: "A-1001", close_ym: "202608", gross: 1800000, clawback_offset: 0, adjustment: 0, withholding_tax: 59400, net: 1740600 },
    { agent_id: "A-1001", close_ym: "202702", gross: 0, clawback_offset: -720000, adjustment: 0, withholding_tax: null, net: 0 },
  ],
  policy_limit: [
    {
      agent_id: "A-1001",
      ledger_id: "1",
      policy_no: "POL-2026-0001",
      contract_date: "2026-08-01",
      fy_start: "2026-08-01",
      fy_end: "2027-07-31",
      monthly_premium: 150000,
      limit_multiple: "12",
      limit_amount: 1800000,
      accum_paid: 1080000,
      cut_total: 0,
      deferred_total: 145000,
      rule_version_id: "1",
    },
  ],
  policy_limit_history: [
    { ledger_id: "1", source_seq: 4, posting_seq: 1, kind: "POST", calc_id: "1", amount: 945000, accum_after: 945000, limit_after: 1800000, occurred_at: "2026-08-01T00:00:00Z", reason: null },
    { ledger_id: "1", source_seq: 5, posting_seq: 2, kind: "POST", calc_id: "2", amount: 855000, accum_after: 1800000, limit_after: 1800000, occurred_at: "2026-08-01T00:00:00Z", reason: null },
    { ledger_id: "1", source_seq: 10, posting_seq: 3, kind: "POST", calc_id: "6", amount: -720000, accum_after: 1080000, limit_after: 1800000, occurred_at: "2027-02-15T00:30:00Z", reason: null },
  ],
  deferral_item: [],
  clawback_item: [{ agent_id: "A-1001", receivable_id: "r-A1001-1", origin_calc_id: "6", amount: 720000, remaining: 0, status: "CLOSED" }],
};

describe("컨텍스트 빌더(설계서 v0.1.14 §4.1(b))", () => {
  it("LINE 2(부록 A-01): 지급 855,000·삭감 145,000·요청 1,000,000(파생)·한도 1,800,000·전기 뒤 100.0%", () => {
    expect(lineContext(A1, "2")).toEqual({
      line: { closeYm: "202608", commType: "INCENTIVE", amount: 855000, limitCutAmt: 145000, limitCutPolicy: "DEFER_AFTER_FY", productKey: "WHOLE-LIFE-20Y", policyMasked: "*********0001" },
      basis: { rate: "1" },
      policySummary: { contractDate: "2026-08-01", monthlyPremium: 150000 },
      ledger: { limitAmount: 1800000, limitMultiple: "12", fyStart: "2026-08-01", fyEnd: "2027-07-31" },
      limitPosting: { accumAfter: 1800000, limitAfter: 1800000, utilizationAfter: "100.0%", postedOn: "2026-08-01" },
      deferrals: [],
      derived: { requested: 1000000 },
    });
  });

  it("LINE 6: 환수 채권·회차, 삭감 없으면 derived 없음", () => {
    const c = lineContext(A1, "6") as Record<string, any>;
    expect(c.receivable).toEqual({ amount: 720000, remaining: 0, status: "CLOSED" });
    expect(c.basis.installmentNo).toBe(7);
    expect(c.derived).toBeUndefined();
  });

  it("LIMIT 1(부록 A-02·A-03): 현재 60.0%·잔여 720,000·이력마다 그 시점 소진율, 분급 스케줄 없음", () => {
    const c = limitContext(A1, "1") as Record<string, any>;
    expect(c.derived).toEqual({ remaining: 720000, utilization: "60.0%", stage: "OK" });
    expect(c.history.map((h: any) => [h.commType, h.accumAfter, h.utilizationAfter])).toEqual([
      ["FY_COMM", 945000, "52.5%"],
      ["INCENTIVE", 1800000, "100.0%"],
      ["CLAWBACK", 1080000, "60.0%"],
    ]);
    expect(c.history[1]).toMatchObject({ limitCutAmt: 145000, limitCutPolicy: "DEFER_AFTER_FY" });
    expect(c.deferrals).toEqual([]);
  });

  it("MONTH_DIFF: 전월 행이 없으면 previous.statement NONE, 차이 없음", () => {
    const c = monthDiffContext(A1, "202702") as Record<string, any>;
    expect(c.previous).toEqual({ closeYm: "202701", statement: "NONE" });
    expect(c.derived).toBeUndefined();
    expect(c.byType).toEqual([{ commType: "CLAWBACK", amount: -720000 }]);
  });

  it("MONTH_DIFF: 전월이 있으면 유형별 차이·총액 차이(DerivedNumbers.delta)", () => {
    const rows: AgentRows = { ...A1, earnings_month: [...A1.earnings_month, { agent_id: "A-1001", close_ym: "202701", gross: 300000, clawback_offset: 0, adjustment: 0, net: 290100 }] };
    rows.earnings_line = [...A1.earnings_line, line("x", "RENEWAL", 300000, "202701", 8)];
    const c = monthDiffContext(rows, "202702") as Record<string, any>;
    expect(c.derived).toEqual({ grossDelta: -300000, clawbackOffsetDelta: -720000, netDelta: -290100 });
    expect(c.byType).toEqual([
      { commType: "CLAWBACK", amount: -720000, previousAmount: undefined, delta: -720000 },
      { commType: "RENEWAL", amount: undefined, previousAmount: 300000, delta: -300000 },
    ].map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))));
  });

  it("어느 컨텍스트에도 증권번호 원문·설계사 ID가 없다(설계서 v0.1.13)", () => {
    for (const s of subjectsOf(A1)) {
      const ctx = JSON.stringify(s.kind === "LINE" ? lineContext(A1, s.subjectId) : s.kind === "LIMIT" ? limitContext(A1, s.subjectId) : monthDiffContext(A1, s.subjectId));
      expect(ctx).not.toMatch(/POL-\d{4}-\d{4,5}/);
      expect(ctx).not.toMatch(/A-\d{4}/);
    }
  });

  it("subject 순서: LINE(source_seq) → LIMIT → MONTH_DIFF(첫 달 제외)", () => {
    expect(subjectsOf(A1).map((s) => `${s.kind}:${s.subjectId}`)).toEqual(["LINE:1", "LINE:2", "LINE:6", "LIMIT:1", "MONTH_DIFF:202702"]);
  });
});

const subject: Subject = { tenantId: "T1", agentId: "A-1001", kind: "LINE", subjectId: "2" };
const good = { text: "이 라인의 지급액은 855,000원이고 145,000원은 한도로 이연되었습니다.", citedFields: ["line.amount", "line.limitCutAmt"], numbersUsed: ["855,000원", "145,000원"] };
const bad = { text: "이 라인은 200,000원이 깎였습니다.", citedFields: ["line.nope"], numbersUsed: ["200,000원"] };

function fake(outputs: unknown[]): { call: Caller; labels: string[] } {
  const labels: string[] = [];
  return {
    labels,
    call: async ({ label }) => {
      labels.push(label);
      return { json: outputs.shift(), provider: "groq", model: "m" };
    },
  };
}

describe("생성 1건: G1 → G4·G5·G6 → 재생성 1회(PHASES Phase 3 항목 3)", () => {
  const ctx = lineContext(A1, "2")!;
  const now = () => "2026-10-31T00:00:00.000Z";

  it("첫 출력이 통과하면 1회로 PASS", async () => {
    const f = fake([good]);
    const r = await generateOne(subject, HASH, ctx, f.call, undefined, now);
    expect(r).toMatchObject({ groundingStatus: "PASS", attempts: 1, promptVersion: promptVersionOf("LINE"), text: good.text });
    expect(f.labels).toEqual(["explain:LINE:A-1001:2"]);
    expect(recordProblems(r)).toEqual([]);
  });

  it("첫 출력이 G4·G5에 걸리면 위반 목록을 붙여 한 번 더, 통과하면 PASS(attempts 2)", async () => {
    const f = fake([bad, good]);
    const r = await generateOne(subject, HASH, ctx, f.call, undefined, now);
    expect(r).toMatchObject({ groundingStatus: "PASS", attempts: 2 });
    expect(f.labels).toEqual(["explain:LINE:A-1001:2", "explain:LINE:A-1001:2#retry"]);
  });

  it("재생성도 실패하면 FAIL로 저장하고 위반을 남긴다(화면에는 노출 안 함 — API가 본문을 내보내지 않는다)", async () => {
    const r = await generateOne(subject, HASH, ctx, fake([bad, { ...bad, text: "보장된 금액 200,000원" }]).call, undefined, now);
    expect(r.groundingStatus).toBe("FAIL");
    expect(r.failure).toEqual({ g4: ["200,000", "numbersUsed:200,000"], g5: ["line.nope"], g6: ["PHRASE:보장"] });
  });

  it("스키마(G1)가 깨진 출력도 재생성 대상", async () => {
    const r = await generateOne(subject, HASH, ctx, fake([{ text: 1 }, good]).call, undefined, now);
    expect(r).toMatchObject({ groundingStatus: "PASS", attempts: 2 });
  });

  it("저장소: 같은 캐시 키(streamHash·promptVersion·kind·subject)는 한 행, 파일에서 다시 읽힌다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "explain-"));
    const store = new ExplanationStore(dir, HASH);
    const r = await generateOne(subject, HASH, ctx, fake([good]).call, undefined, now);
    store.put(r);
    store.put(r);
    expect(new ExplanationStore(dir, HASH).all()).toEqual([r]);
    expect(new ExplanationStore(dir, HASH).has({ ...subject, promptVersion: promptVersionOf("LINE") })).toBe(true);
    expect(readFileSync(join(dir, HASH, "line.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });
});

// ─── 적재·전수 재검증(node:sqlite — D1과 같은 엔진, 마이그레이션 0001~0004 그대로) ───
const MIGRATIONS = ["0001_init.sql", "0002_ab_slots.sql", "0003_demo_agents.sql", "0004_explanation_pk.sql"].map((f) => readFileSync(join(REPO_ROOT, "worker/migrations", f), "utf8"));

describe("적재(load:d1 --explain)와 적재 후 전수 재검증(설계서 §5.4, PHASES Phase 3 항목 4)", () => {
  let sqlite: DatabaseSync;
  let db: D1Exec;
  const views = {
    agent_profile: [{ agent_id: "A-1001", name: "허구설계사01", org_path: "/HQ1", status: "ACTIVE", valid_from: "2025-07-01", last_seq: 1 }],
    earnings_line: A1.earnings_line,
    earnings_month: A1.earnings_month.map((m) => ({ ...m, status: "ESTIMATED", last_seq: 1 })),
    policy_limit: A1.policy_limit.map((l) => ({ ...l, last_posting_seq: 3 })),
    policy_limit_history: A1.policy_limit_history.map(({ ledger_id, source_seq, posting_seq, kind, calc_id, amount, accum_after, limit_after, occurred_at }) => ({
      ledger_id,
      source_seq,
      posting_seq,
      kind,
      calc_id,
      amount,
      accum_after,
      limit_after,
      occurred_at,
    })),
    clawback_item: A1.clawback_item.map((c) => ({ ...c, last_seq: 10 })),
  };
  const demo = ["A-1001", "A-1002", "A-1003"].map((agentId, i) => ({ demoNo: (i + 1) as 1 | 2 | 3, agentId, scenario: `A${i + 1}` as "A1", cardLabel: "c", contractCount: 1, basis: {} }));

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    for (const m of MIGRATIONS) sqlite.exec(m);
    db = { query: (sql) => sqlite.prepare(sql).all() as Record<string, unknown>[], apply: (st) => st.map((s) => ({ changes: Number(sqlite.prepare(s).run().changes) })) };
    // 0001의 월 합산 불변식: 202702 gross 0·clawback −720,000 = 라인 Σ, 202608 1,800,000 = 945,000 + 855,000
    loadSlot(db, { hash: HASH, generatedAt: "2026-10-30T00:00:00Z", eventCount: 1, planPrompt: "plan/v1", demoAgents: demo }, views, { migrationSql: loadMigration(), log: () => {}, now: () => "2026-10-30T00:00:00Z" });
  });

  async function records() {
    const now = () => "2026-10-31T00:00:00.000Z";
    return [
      await generateOne(subject, HASH, lineContext(A1, "2")!, fake([good]).call, undefined, now),
      await generateOne({ ...subject, kind: "MONTH_DIFF", subjectId: "202702" }, HASH, monthDiffContext(A1, "202702")!, fake([{ text: "2027년 2월에 720,000원이 환수되었습니다.", citedFields: ["byType[0].amount"], numbersUsed: ["720,000원"] }]).call, undefined, now),
      await generateOne({ ...subject, subjectId: "1" }, HASH, lineContext(A1, "1")!, fake([bad, bad]).call, undefined, now),
    ];
  }

  it("없는 키만 넣고(두 번째 적재는 0행), 스트림이 stream_meta에 없으면 멈춘다", async () => {
    const rs = await records();
    expect(loadExplanations(db, HASH, rs, () => {})).toMatchObject({ records: 3, inserted: 3, totalAfter: 3 });
    expect(loadExplanations(db, HASH, rs, () => {})).toMatchObject({ alreadyLoaded: 3, inserted: 0, totalAfter: 3 });
    expect(() => loadExplanations(db, "b".repeat(64), [], () => {})).toThrow(/stream_meta/);
  });

  it("같은 달 MONTH_DIFF를 설계사마다 둘 수 있다(PK에 agent_id — 설계서 v0.1.15)", async () => {
    const [, month] = await records();
    loadExplanations(db, HASH, [month!, { ...month!, agentId: "A-1002" }], () => {});
    expect(Number(db.query("SELECT COUNT(*) AS n FROM explanation WHERE kind = 'MONTH_DIFF' AND subject_id = '202702'")[0]!.n)).toBe(2);
  });

  it("재검증: D1 슬롯 표로 컨텍스트를 다시 만들어 PASS 행 위반 0", async () => {
    loadExplanations(db, HASH, await records(), () => {});
    const r = recheckExplanations(db);
    expect(r).toMatchObject({ streamHash: HASH, slot: "a", active: true, rows: 3, pass: 2, fail: 1, violations: [] });
  });

  it("재검증은 D1에서 바뀐 본문·데이터를 잡는다(검증기·적재기 버그 방어)", async () => {
    loadExplanations(db, HASH, await records(), () => {});
    sqlite.exec("UPDATE explanation SET text = '이 라인의 지급액은 900,000원입니다.' WHERE subject_id = '2'");
    sqlite.exec("UPDATE earnings_line_a SET amount = 700000 WHERE calc_id = '6'");
    sqlite.exec("UPDATE earnings_month_a SET clawback_offset = -700000 WHERE close_ym = '202702'");
    const r = recheckExplanations(db);
    expect(r.violations.map((v) => [v.subjectId, v.problems])).toEqual([
      ["2", ["G4 900,000"]],
      ["202702", ["G4 720,000", "G4 numbersUsed:720,000"]],
    ]);
  });

  it("비활성 슬롯 비우기는 그 스트림의 설명도 지운다", async () => {
    loadExplanations(db, HASH, await records(), () => {});
    loadSlot(db, { hash: "c".repeat(64), generatedAt: "2026-10-31T00:00:00Z", eventCount: 1, planPrompt: "plan/v1", demoAgents: demo }, views, { migrationSql: loadMigration(), log: () => {}, now: () => "2026-10-31T00:00:00Z" });
    purgeInactive(db, () => {});
    expect(Number(db.query("SELECT COUNT(*) AS n FROM explanation")[0]!.n)).toBe(0);
  });
});

describe("라벨·토큰 도우미", () => {
  it("VCR 라벨은 종류·설계사·subject", () => {
    expect(labelOf(subject)).toBe("explain:LINE:A-1001:2");
  });
  it("검증기 토큰은 쉼표 금액을 정수로", () => {
    expect(extractTokens("855,000원").map((t) => t.value)).toEqual(["855000"]);
  });
});

describe("배치 실호출 오류 분류(Workers AI 오류 코드 3036·3040, Groq json_validate_failed)", () => {
  const err = (status: number, body: string, retryAfter: number | null = null, badContent = false) => new ProviderError(`workers-ai ${status}: ${body}`, status, retryAfter, badContent);
  it("3036(하루 무료 뉴런 소진)은 retry-after 없어도 그 공급자 그날 끝", () => {
    expect(classifyError(err(429, '{"errors":[{"message":"AiError: You have used up your daily free allocation of 10,000 neurons","code":3036}]}')).action).toBe("budget");
  });
  it("3040(용량 초과)·짧은 429는 기다렸다 같은 요청, 긴 retry-after(Groq TPD)는 그날 끝", () => {
    expect(classifyError(err(429, '{"errors":[{"message":"Capacity temporarily exceeded","code":3040}]}'))).toEqual({ action: "wait", reason: "3040", waitS: 30 });
    expect(classifyError(err(429, "rate limit", 7))).toEqual({ action: "wait", reason: "429", waitS: 7 });
    expect(classifyError(err(429, "tokens per day", 900)).action).toBe("budget");
  });
  it("구조화 출력 실패(400 json_validate_failed·JSON Mode couldn't be met·빈/JSON 아닌 본문)는 json — 3회면 G1 실패로 넘긴다", () => {
    expect(classifyError(err(400, '{"error":{"code":"json_validate_failed","failed_generation":""}}')).action).toBe("json");
    expect(classifyError(err(400, "JSON Mode couldn't be met")).action).toBe("json");
    expect(classifyError(err(502, "빈 응답", null, true))).toEqual({ action: "json", reason: "bad_content" });
  });
  it("5xx는 재시도, 401·그 밖 400은 멈춤 — response_format 거부 400만 폴백 대상", () => {
    expect(classifyError(err(503, "upstream")).action).toBe("retry");
    expect(classifyError(err(401, "Authentication error")).action).toBe("fatal");
    expect(classifyError(new Error("x")).action).toBe("fatal");
    expect(rejectsResponseFormat(err(400, "Unsupported parameter: response_format"))).toBe(true);
    expect(rejectsResponseFormat(err(400, "json_validate_failed json_schema"))).toBe(false);
    expect(rejectsResponseFormat(err(401, "response_format"))).toBe(false);
  });
  it("본문 파싱: 그대로 JSON 또는 코드 울타리 하나로 감싼 JSON(프롬프트 강제 JSON 모드)", () => {
    expect(parseContent('{"text":"a"}')).toEqual({ text: "a" });
    expect(parseContent('```json\n{"text":"a"}\n```')).toEqual({ text: "a" });
    expect(() => parseContent("설명입니다")).toThrow();
  });
});

describe("리포트 문장 수(게이트 아님 — 모델별 평균만 남긴다)", () => {
  it("마침표 뒤 공백·끝으로 나누고 소수점은 나누지 않는다", () => {
    expect(sentenceCount("초년도 수수료가 945,000원으로 산출되었습니다. 소진율은 52.5%입니다.")).toBe(2);
    expect(sentenceCount("요율 7과 지급률 0.9를 적용한 값입니다. 한도는 1,800,000원입니다. 이연되었습니다")).toBe(3);
    expect(sentenceCount("")).toBe(0);
  });
});
