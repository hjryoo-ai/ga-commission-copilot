import { spawnSync } from "node:child_process";
import { extractTokens } from "@copilot/grounding";
import { beforeAll, describe, expect, it } from "vitest";
import { type AgentRows, contextOf } from "../explain/context.ts";
import { agentRowsOf, allSubjects, runStub, VCR_NAME, vcrSubjects } from "../explain/run.ts";
import { ExplanationStore } from "../explain/store.ts";
import { pickStream, readMeta, viewsOf } from "../load/views.ts";
import { openStub } from "../providers/cassette.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PHASES Phase 3 항목 2 + 골든(부록 A-01·A-02·A-03, stub 응답으로 고정): 커밋된 스트림을 projection-java로 리플레이해 데모 3명의 subject를 만들고,
// VCR 16건(설계서 v0.1.14 §4.1(b))을 재생해 같은 요청 해시·같은 판정이 나오는지 본다. LLM 실호출 없음.
const java = spawnSync("java", ["-version"]).status === 0;

describe.skipIf(!java)("커밋된 스트림의 설명 대상과 VCR 재생", () => {
  let hash: string;
  let rows: AgentRows[];
  let byAgent: Map<string, AgentRows>;

  beforeAll(() => {
    hash = pickStream(undefined);
    const meta = readMeta(hash);
    rows = agentRowsOf(viewsOf(hash, meta), meta.demoAgents!.map((d) => d.agentId));
    byAgent = new Map(rows.map((r) => [r.agentId, r]));
  }, 600_000);

  it("대상 591건 = LINE 482 · LIMIT 21 · MONTH_DIFF 88(설계서 v0.1.14 §4.1(b)), 데모 3명만", () => {
    const all = allSubjects(rows);
    const count = (k: string) => all.filter((s) => s.kind === k).length;
    expect([all.length, count("LINE"), count("LIMIT"), count("MONTH_DIFF")]).toEqual([591, 482, 21, 88]);
    expect(new Set(all.map((s) => s.agentId))).toEqual(new Set(["A-1001", "A-1002", "A-1003"]));
    // 순서: 종류 먼저
    const kinds = all.map((s) => s.kind);
    expect(kinds.indexOf("LIMIT")).toBe(482);
    expect(kinds.indexOf("MONTH_DIFF")).toBe(503);
  });

  it("모든 컨텍스트에 증권번호 원문·설계사 ID가 없다", () => {
    for (const s of allSubjects(rows)) {
      const c = JSON.stringify(contextOf(byAgent.get(s.agentId)!, s.kind, s.subjectId));
      expect(c, `${s.kind} ${s.subjectId}`).not.toMatch(/POL-\d{4}-\d{4,5}|A-\d{4}/);
    }
  });

  it("VCR 대상 16건 = LINE 10 · LIMIT 3 · MONTH_DIFF 3, A-1 라인 1·2·6·원장 1·202702 포함", () => {
    const v = vcrSubjects(rows);
    expect(v.map((s) => s.kind).join(",")).toBe(`${"LINE,".repeat(10)}LIMIT,LIMIT,LIMIT,MONTH_DIFF,MONTH_DIFF,MONTH_DIFF`);
    expect(v.slice(0, 3).map((s) => s.subjectId)).toEqual(["1", "2", "6"]);
    expect(v.find((s) => s.kind === "LIMIT")).toMatchObject({ agentId: "A-1001", subjectId: "1" });
    expect(v.find((s) => s.kind === "MONTH_DIFF")).toMatchObject({ agentId: "A-1001", subjectId: "202702" });
  });

  describe("VCR 재생(--stub)", () => {
    let store: ExplanationStore;
    beforeAll(async () => {
      store = new ExplanationStore(mkdtempSync(join(tmpdir(), "explain-stub-")), hash);
      await runStub(hash, byAgent, vcrSubjects(rows), store);
    });

    it("16건 모두 재생된다(요청 해시 = 녹화 해시 — 프롬프트·컨텍스트가 녹화 때와 같다)", () => {
      expect(openStub(VCR_NAME).kind).toBe("vcr");
      expect(store.all()).toHaveLength(16);
    });

    const text = (kind: string, subjectId: string) => store.all().find((r) => r.kind === kind && r.subjectId === subjectId && r.agentId === "A-1001")!;
    const values = (t: string) => new Set(extractTokens(t).map((x) => x.value));

    it("골든 A-01(라인 2): 요청 1,000,000 · 지급 855,000 · 한도 초과 145,000 · 한도 1,800,000 · 사유=한도", () => {
      const r = text("LINE", "2");
      expect(r.groundingStatus).toBe("PASS");
      for (const v of ["1000000", "855000", "145000", "1800000"]) expect(values(r.text), r.text).toContain(v);
      expect(r.text).toMatch(/한도/);
    });

    it("골든 A-02(원장 1): 한도 초과 145,000 · 이연 · 지급 예정월은 데이터로 확인되지 않음(임의 월 없음 — G4)", () => {
      const r = text("LIMIT", "1");
      expect(r.groundingStatus).toBe("PASS");
      expect(values(r.text), r.text).toContain("145000");
      expect(r.text).toMatch(/이연|DEFER_AFTER_FY/);
      expect(r.text).toMatch(/확인되지 않/);
    });

    it("골든 A-03(원장 1): 누적 1,800,000 = 한도 1,800,000 · 소진율 100.0%", () => {
      const r = text("LIMIT", "1");
      expect(values(r.text), r.text).toContain("1800000");
      expect(extractTokens(r.text).some((t) => t.kind === "percent" && t.value === "100"), r.text).toBe(true);
    });
  });
});
