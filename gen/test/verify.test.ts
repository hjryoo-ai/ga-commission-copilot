import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Envelope, expand, sha256, toJsonl } from "../world/expand.ts";
import { buildPlan } from "../world/plan.ts";
import type { CliRun, ReplaySummary } from "../verify/g2.ts";
import { runG2 } from "../verify/g2.ts";
import { DEMO_CARD_LABELS, requiredCases, selectDemoAgents } from "../verify/g3.ts";
import { runG1, streamMeta, verify } from "../verify/index.ts";

// Phase 1 항목 5: G1 → G2 → G3. G2의 실제 CLI 실행은 증거 문서(pnpm run verify)로 보고, 여기서는 종료 코드·요약 처리 규칙을 가짜 실행기로 본다.
const { plan } = await buildPlan("stub");
const events = expand(plan);
const jsonl = toJsonl(events);
const hash = sha256(jsonl);
const p = (e: Envelope) => e.payload as Record<string, any>;
const without = (pred: (e: Envelope) => boolean) => events.filter((e) => !pred(e));
const caseOf = (evs: readonly Envelope[], id: string) => requiredCases(evs).find((c) => c.id === id)!;

const goodSummary: ReplaySummary = {
  ok: true,
  streamSha256: hash,
  events: events.length,
  viewsSha256: "a".repeat(64),
  viewsSha256Second: "a".repeat(64),
  tables: { earnings_line: 5192 },
  violationCount: 0,
  violations: [],
};
const fake = (r: Partial<CliRun>) => () => ({ status: 0, stdout: "", stderr: "", ...r });
const expected = { sha256: hash, events: events.length };

describe("G1", () => {
  it("생성 스트림 전부 봉투 스키마 통과", () => {
    expect(runG1(events)).toMatchObject({ status: "PASS", invalid: 0, events: events.length });
  });

  it("payload 필드가 빠진 이벤트는 실패하고 seq를 남긴다", () => {
    const bad = events.map((e, i) => (i === 40 ? { ...e, payload: { ...p(e), agentId: undefined } } : e));
    const r = runG1(JSON.parse(JSON.stringify(bad)));
    expect(r.status).toBe("FAIL");
    expect(r.examples[0]).toMatch(new RegExp(`^seq ${events[40]!.seq} `));
  });
});

describe("G2: 종료 코드를 먼저 본다", () => {
  it("exit 0 + 정상 요약 → PASS", () => {
    expect(runG2("s", expected, fake({ stdout: `${JSON.stringify(goodSummary)}\n` })).status).toBe("PASS");
  });

  it("exit 1 → 요약이 있으면 위반 목록을 싣고 FAIL", () => {
    const s = { ...goodSummary, ok: false, violationCount: 1, violations: ["SUM_MISMATCH seq 93 …"] };
    const r = runG2("s", expected, fake({ status: 1, stdout: JSON.stringify(s) }));
    expect(r.status).toBe("FAIL");
    expect(r.reasons).toEqual(["CLI exit 1(불변식 위반)", "SUM_MISMATCH seq 93 …"]);
  });

  it("exit 1·2는 요약이 없거나 깨져도 FAIL, 신호 종료도 FAIL", () => {
    expect(runG2("s", expected, fake({ status: 1, stdout: "{broken" })).status).toBe("FAIL");
    expect(runG2("s", expected, fake({ status: 2, stderr: "usage" })).reasons).toEqual(["CLI exit 2(사용법·입력 오류)", "usage"]);
    // exit 1인데 stdout이 ok:true라고 해도 종료 코드가 이긴다
    expect(runG2("s", expected, fake({ status: 1, stdout: JSON.stringify(goodSummary) })).status).toBe("FAIL");
    expect(runG2("s", expected, fake({ status: null })).reasons[0]).toBe("CLI가 신호로 종료");
  });

  it("exit 0이어도 요약이 없거나·깨졌거나·2회 해시가 다르거나·다른 스트림을 읽었으면 FAIL", () => {
    expect(runG2("s", expected, fake({ stdout: "" })).status).toBe("FAIL");
    expect(runG2("s", expected, fake({ stdout: "not json" })).status).toBe("FAIL");
    expect(runG2("s", expected, fake({ stdout: JSON.stringify({ ...goodSummary, viewsSha256Second: "b".repeat(64) }) })).reasons).toContain("2회 리플레이 뷰 해시 다름");
    expect(runG2("s", expected, fake({ stdout: JSON.stringify({ ...goodSummary, streamSha256: "0".repeat(64) }) })).status).toBe("FAIL");
    expect(runG2("s", expected, fake({ stdout: JSON.stringify({ ...goodSummary, events: 1 }) })).status).toBe("FAIL");
  });
});

describe("G3: 상위 부록 B 8종(경계 넷은 4항목) + A-1 payload 동등 + 데모 설계사 선정, 항목별 PASS/FAIL", () => {
  it("항목 13개, id 고정 순서", () => {
    expect(requiredCases(events).map((c) => c.id)).toEqual([
      "LIMIT_80_95_100",
      "CUT_AND_DEFER",
      "REBASE",
      "DEFERRAL_HELD",
      "RECEIVABLE_CARRIED",
      "REVERSAL_PAIR",
      "ADJUSTMENT_AFTER_CLOSE",
      "BOUNDARY_LIMIT_BEFORE",
      "BOUNDARY_LIMIT_AFTER",
      "BOUNDARY_DEFERRAL_BEFORE",
      "BOUNDARY_DEFERRAL_AFTER",
      "A1_GOLDEN",
      "DEMO_AGENTS",
    ]);
  });

  it("생성 스트림에서 13항목 전부 PASS(경계 넷 각각 포함)", () => {
    expect(requiredCases(events).filter((c) => c.status !== "PASS")).toEqual([]);
  });

  it("각 항목은 근거 이벤트를 지우면 FAIL", () => {
    expect(caseOf(without((e) => e.type === "LimitLedgerRebased"), "REBASE").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "DeferralStatusChanged" && p(e).to === "HELD"), "DEFERRAL_HELD").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "ClawbackReceivableUpdated" && p(e).status === "OPEN"), "RECEIVABLE_CARRIED").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "CommissionCalculated" && Boolean(p(e).reversalOfCalcId)), "REVERSAL_PAIR").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "AdjustmentPosted"), "ADJUSTMENT_AFTER_CLOSE").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "CommissionCalculated" && p(e).limitCutPolicy === "CUT"), "CUT_AND_DEFER").status).toBe("FAIL");
    expect(caseOf(without((e) => e.type === "LimitLedgerPosted"), "LIMIT_80_95_100").status).toBe("FAIL");
  });

  it("A-1 계약 payload가 1원이라도 다르면 A1_GOLDEN FAIL", () => {
    const changed = events.map((e) => (e.type === "CommissionCalculated" && p(e).calcId === "1" ? { ...e, payload: { ...p(e), amount: p(e).amount + 1 } } : e));
    expect(caseOf(changed, "A1_GOLDEN").status).toBe("FAIL");
  });

  it("데모 설계사: 운영자 결정(DECISIONS 2026-10-30)과 같은 3명을 규칙으로 고른다", () => {
    const d = selectDemoAgents(events);
    expect(d.map((x) => [x.demoNo, x.agentId, x.scenario, x.cardLabel])).toEqual([
      [1, "A-1001", "A1", DEMO_CARD_LABELS[1]],
      [2, "A-1002", "A2", DEMO_CARD_LABELS[2]],
      [3, "A-1003", "A3", DEMO_CARD_LABELS[3]],
    ]);
    expect(d[1]!.basis).toMatchObject({ scheduleId: "s-POL-2027-0003-1" });
    expect(d[2]!.basis).toMatchObject({ ledgerId: "l-POL-2026-03013", receivableId: "r-A-1003-1" });
    expect(d.every((x) => x.contractCount > 0)).toBe(true);
  });

  it("데모 설계사: 조건을 못 채우면 다음 후보로, 3명을 못 채우면 DEMO_AGENTS FAIL", () => {
    // A-1003의 환수 상계를 지우면 3번은 조건(OPEN 뒤 OFFSET)을 채우는 다음 재산정 설계사로 넘어간다
    const noOffset = without((e) => e.type === "ClawbackReceivableUpdated" && p(e).agentId === "A-1003" && p(e).status === "OFFSET");
    const next = selectDemoAgents(noOffset).find((x) => x.demoNo === 3);
    expect(next?.agentId).not.toBe("A-1003");
    // 재산정이 하나도 없으면 3번을 못 채운다
    const r = caseOf(without((e) => e.type === "LimitLedgerRebased"), "DEMO_AGENTS");
    expect(r).toMatchObject({ status: "FAIL", detail: expect.stringMatching(/3 없음$/) });
    // HELD가 없으면 2번을 못 채운다
    expect(caseOf(without((e) => e.type === "DeferralStatusChanged" && p(e).to === "HELD"), "DEMO_AGENTS").status).toBe("FAIL");
  });

  it("경계 넷: 날짜마다 따로 판정 — 그 날 체결 계약이 없거나 규칙이 그 날짜에서 갈리지 않으면 그 항목만 FAIL", () => {
    // 2026-07-01 체결 계약 하나의 원장을 지운다 → 한도 적용 경계만 깨진다
    const one = events.find((e) => e.type === "LimitLedgerOpened" && p(e).contractDate === "2026-07-01")!;
    const broken = requiredCases(without((e) => e.type === "LimitLedgerOpened" && p(e).ledgerId === p(one).ledgerId));
    expect(broken.filter((c) => c.status === "FAIL").map((c) => c.id)).toEqual(["BOUNDARY_LIMIT_AFTER"]);
    // 2027-01-01 체결 계약을 통째로 지운다 → 분급 적용 경계만 깨진다
    const jan1 = new Set(events.filter((e) => e.type === "CommissionCalculated" && p(e).policySummary?.contractDate === "2027-01-01").map((e) => p(e).policyNo));
    expect(jan1.size).toBeGreaterThan(0);
    const gone = requiredCases(without((e) => jan1.has(p(e).policyNo)));
    expect(gone.find((c) => c.id === "BOUNDARY_DEFERRAL_AFTER")).toMatchObject({ status: "FAIL", detail: expect.stringMatching(/^2027-01-01 체결 0건/) });
  });
});

describe("verify: 앞 게이트가 실패하면 뒤는 SKIPPED", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-"));
  const file = join(dir, "stream.jsonl");
  writeFileSync(file, jsonl);

  it("G2 실패 → G3 SKIPPED, ok=false", () => {
    const r = verify(file, fake({ status: 1 }));
    expect(r.gates.G1.status).toBe("PASS");
    expect(r.gates.G2.status).toBe("FAIL");
    expect(r.gates.G3).toEqual({ status: "SKIPPED", cases: [], demoAgents: [] });
    expect(r.ok).toBe(false);
  });

  it("G1 실패 → CLI를 부르지 않는다", () => {
    const broken = join(dir, "broken.jsonl");
    writeFileSync(broken, toJsonl(events.map((e, i) => (i === 0 ? { ...e, type: "NotAnEvent" } : e))));
    let called = false;
    const r = verify(broken, () => {
      called = true;
      return { status: 0, stdout: "", stderr: "" };
    });
    expect(called).toBe(false);
    expect([r.gates.G1.status, r.gates.G2.status, r.gates.G3.status]).toEqual(["FAIL", "SKIPPED", "SKIPPED"]);
  });

  it("meta에는 생성 시각·프롬프트 버전·이벤트 수·뷰 해시·필수 케이스·픽스처/녹화 여부·데모 설계사가 있다", () => {
    const r = verify(file, fake({ stdout: JSON.stringify(goodSummary) }));
    const meta = streamMeta(r, { prompt: "plan/v1", repairPrompt: "plan_repair/v1", mode: "stub", source: "vcr", liveCalls: 0 }, "f".repeat(64), "2026-10-30T00:00:00.000Z");
    expect(meta).toMatchObject({
      streamSha256: hash,
      generatedAt: "2026-10-30T00:00:00.000Z",
      eventCount: events.length,
      plan: { prompt: "plan/v1", repairPrompt: "plan_repair/v1", source: "vcr", liveCalls: 0 },
      replay: { viewsSha256: goodSummary.viewsSha256 },
    });
    expect(meta.requiredCases).toHaveLength(13);
    expect(meta.demoAgents.map((d) => d.agentId)).toEqual(["A-1001", "A-1002", "A-1003"]);
  });
});
