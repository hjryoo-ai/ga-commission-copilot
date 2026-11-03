import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ScopedQuery } from "../src/db/ScopedQuery";
import { sessionBlock } from "../src/llm/answer";
import { parseToolCall, runTool } from "../src/tools";
import { DEMO_STREAM, seedDemoStream } from "./demo-stream";

// 운영자 2026-11-02: 재생 픽스처가 시험 D1에 그대로 들어가고, 툴이 실제 데모 행을 읽는지(카세트 재생 시험의 전제).
beforeEach(seedDemoStream);

describe("답변 재생 픽스처(실제 스트림 데모 설계사 3명)", () => {
  it("활성 스트림 = 픽스처 해시, 라인 수 = 데모 3명 라인", async () => {
    const res = await exports.default.fetch("https://example.com/api/v1/health");
    expect(await res.json()).toMatchObject({ ok: true, streamHash: DEMO_STREAM.streamHash, earningsLines: DEMO_STREAM.counts.earnings_line });
    expect(DEMO_STREAM.demoAgents.map((d) => d.agentId)).toEqual(["A-1001", "A-1002", "A-1003"]);
  });

  it("툴은 그 설계사 행만: A-1001 원장 1(부록 A-1 POL-2026-0001), 사규집 40청크·sim_stub 1행", async () => {
    const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: { streamHash: DEMO_STREAM.streamHash, slot: "a" } });
    const r = await runTool({ q }, parseToolCall({ tool: "get_limit", args: { policyNo: "0001" } }));
    expect(r.data).toMatchObject({ found: true, ledger: { ledgerId: "1", limitAmount: 1800000 } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM rulebook_chunk WHERE version = ?").bind(DEMO_STREAM.rulebookVersion).first("n")).toBe(40);
    expect(await env.DB.prepare("SELECT agent_id, policy_no FROM sim_stub").all().then((x) => x.results)).toEqual([{ agent_id: "A-1001", policy_no: "POL-2026-0001" }]);
  });

  it("answer/v2 <session>: 명세 달·계약 끝 4자리·해약 시뮬레이션 준비 계약(그 설계사 행만)", async () => {
    const q = (agentId: string) => new ScopedQuery(env.DB, { tenantId: "T1", agentId, stream: { streamHash: DEMO_STREAM.streamHash, slot: "a" } });
    const s1 = await sessionBlock(q("A-1001"));
    expect(s1.split("\n")[0]).toMatch(/^명세가 있는 달\(yyyyMM\): 202603, 202604, .*202608, .*202708, .*202806$/);
    expect(s1).toContain("계약(증권번호 끝 4자리): 0001, ");
    expect(s1).not.toMatch(/POL-/);
    expect(s1.split("\n")[2]).toBe("해약 시뮬레이션이 준비된 계약(끝 4자리): 0001");
    expect((await sessionBlock(q("A-1002"))).split("\n")[2]).toBe("해약 시뮬레이션이 준비된 계약(끝 4자리): 없음");
  });
});
