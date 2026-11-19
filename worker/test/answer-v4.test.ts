import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { rulebookChunks, ScopedQuery } from "../src/db/ScopedQuery";
import { type AnswerDeps, type AnswerOutput, answerQuestion, dataBlock, fitStage2, otherAgentIds, PROMPT_OVERHEAD_TOKENS, QUESTION_MAX_TOKENS, REFUSAL_TEXT, STAGE2_OUTPUT_RESERVE } from "../src/llm/answer";
import { estimateTokens } from "../src/tools/result";
import { activePrompt, render } from "../src/llm/promptRegistry";
import type { StructuredRequest } from "../src/llm/providers";
import { contextKeys, fieldInContext, type Json } from "@copilot/grounding";
import { parseToolCall, runTool } from "../src/tools";
import { HASH, seed } from "./fixture";

// 설계서 v0.1.44(PR-B): answer/v4 — 단계 구역, 툴 결과 v2(라벨·안정 키·citable), RULES_UNAVAILABLE 서버 조건, 다른 설계사 ID 가드, 인자 거부 결과.
// LLM·임베딩·Vectorize는 가짜, D1은 로컬.
const q = (agentId = "A-1001") => new ScopedQuery(env.DB, { tenantId: "T1", agentId, stream: { streamHash: HASH, slot: "a" } });
const ENV = { PROMPT_VERSIONS: "answer=v4" };
const CHUNK = { chunk_id: "rb-0123456789ab-a12-1", article: "제12조", title: "수수료 한도의 산정", body: "제12조(수수료 한도의 산정) — 가상 규정 · 예시값\n1. 계약별 수수료 한도는 월납 보험료에 12배를 곱한 금액으로 한다." };

beforeEach(async () => {
  await seed();
  for (const t of ["rulebook_chunk", "answer_log", "sim_stub"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await env.DB.prepare("INSERT INTO rulebook_chunk (chunk_id, article, title, body, visibility, version, token_count) VALUES (?, ?, ?, ?, 'agent', '0123456789ab', 50)").bind(CHUNK.chunk_id, CHUNK.article, CHUNK.title, CHUNK.body).run();
});

let seq = 0;
const out = (o: Partial<AnswerOutput>): AnswerOutput => ({ refused: false, reason: null, text: "", numbersUsed: [], citations: [], toolCalls: [], ...o });
const tc = (tool: string, args: Partial<Record<"ym" | "policyNo" | "from" | "to", string>>) => ({ tool, args: { ym: null, policyNo: null, from: null, to: null, ...args } });

/** v4 가짜 공급자: 2단계는 <data> 구역이 있는 요청. */
function deps(stage1: AnswerOutput, stage2?: (data: unknown[]) => AnswerOutput, opts: { embedFails?: boolean } = {}): AnswerDeps & { seen: StructuredRequest[] } {
  const seen: StructuredRequest[] = [];
  return {
    seen,
    provider: {
      name: "groq",
      async structured(req) {
        seen.push(req);
        const m = /^<data>\n([\s\S]*?)\n<\/data>$/m.exec(req.messages[0]!.content);
        return { json: m ? stage2!(JSON.parse(m[1]!) as unknown[]) : stage1, provider: "groq", model: "openai/gpt-oss-120b", usage: null };
      },
    },
    embed: async () => {
      if (opts.embedFails) throw new Error("4006");
      return Array.from({ length: 1024 }, () => 0.01);
    },
    search: async () => [{ id: CHUNK.chunk_id, score: 0.9 }],
    chunks: (ids) => rulebookChunks(env.DB, ids),
    now: () => new Date("2026-11-16T01:00:00Z"),
    newId: () => `v4-${++seq}`,
  };
}

describe.each(["v4", "v5"])("answer/%s 프롬프트 — 단계 구역(v0.1.44 §4.3)", (v) => {
  const p = activePrompt({ PROMPT_VERSIONS: `answer=${v}` }, "answer");
  const vars = (two: boolean) => ({ stage: two ? "2단계" : "1단계", stage1: two ? "" : "1", stage2: two ? "1" : "", session: "SESSION", rules: "RULES", data: "DATA", question: "Q" });

  it(`${v}는 스키마 v2·툴 결과 v2(frontmatter tool_results)`, () => {
    expect(p).toMatchObject({ version: v, toolResults: "v2", maxContextTokens: 3600 });
    expect((p.outputSchema as { properties: { reason: { enum: unknown[] } } }).properties.reason.enum).toContain("RULES_UNAVAILABLE");
  });

  it("1단계에는 툴 목록·<session>이 있고 <data>가 없다, 2단계는 반대", () => {
    const one = render(p.body, vars(false));
    const two = render(p.body, vars(true));
    expect(one).toContain("SESSION");
    expect(one).toContain("get_policy_event_sim(policyNo)");
    expect(one).not.toMatch(/^<data>$/m);
    expect(two).not.toContain("SESSION");
    expect(two).not.toContain("get_policy_event_sim(policyNo)");
    expect(two).toContain("<data>\nDATA\n</data>");
    expect(one).not.toContain("{{");
    expect(two).not.toContain("{{");
  });

  it("v3 본문은 구역이 없어 그대로(카세트 해시 불변)", () => {
    const v3 = activePrompt({ PROMPT_VERSIONS: "answer=v3" }, "answer");
    expect(v3.toolResults).toBe("v1");
    expect(render(v3.body, { ...vars(false), data: "" })).toBe(render(v3.body, { stage: "1단계", session: "SESSION", rules: "RULES", data: "", question: "Q" }));
  });
});

describe("툴 결과 v2(v0.1.44 §4.3.1)", () => {
  it("get_statement: 코드 옆 라벨, byType 키는 코드 그대로 + byTypeLabel, citable은 키 경로", async () => {
    const r = await runTool({ q: q(), version: "v2" }, parseToolCall({ tool: "get_statement", args: { ym: "202608" } }));
    const d = r.data as Record<string, unknown> & { lines: Record<string, unknown>[]; byType: Record<string, number>; byTypeLabel: Record<string, string>; citable: string[] };
    expect(d.status).toBe("PAID");
    expect(d.statusLabel).toBe("지급완료");
    expect(Object.keys(d.byType)).toContain("FY_COMM");
    expect(d.byTypeLabel.FY_COMM).toBe("초년도 수수료");
    const cut = d.lines.find((l) => l.calcId === "c2")!;
    expect(cut).toMatchObject({ commType: "INCENTIVE", commTypeLabel: "시책", limitCutPolicy: "CUT", limitCutPolicyLabel: "한도 초과분 삭감" });
    // v0.1.48: 틀 표기 없이 실제 숫자 잎 경로만
    expect(d.citable).toContain("byType.FY_COMM");
    expect(d.citable).toContain("lines[calcId=c2].limitCutAmt");
    expect(d.citable.filter((c) => /[{}<>…]/.test(c))).toEqual([]);
    expect(r.unregistered).toBe(0);
  });

  it("citable 항목 전부가 자기 결과에 대해 G5를 통과하고, 숫자 잎만 가리킨다(v0.1.48 — 툴 4종)", async () => {
    const pol = (await env.DB.prepare("SELECT policy_no FROM policy_limit_a WHERE agent_id = 'A-1001' AND policy_no LIKE '%0001'").first<{ policy_no: string }>())!.policy_no;
    await env.DB.prepare("INSERT INTO sim_stub (tenant_id, agent_id, policy_no, kind, response, rule_snapshot_id) VALUES ('T1', 'A-1001', ?, 'POLICY_EVENT', ?, 'snap-1')")
      .bind(pol, JSON.stringify({ policyNo: pol, event: "CANCEL", clawbackAmount: -720_000, offsetAgainstMonth: "202702", months: [1, 2] }))
      .run();
    const calls = [
      { tool: "get_statement", args: { ym: "202608" } },
      { tool: "get_limit", args: { policyNo: "0001" } },
      { tool: "get_deferrals", args: { from: "202601", to: "202812" } },
      { tool: "get_policy_event_sim", args: { policyNo: "0001" } },
    ];
    for (const c of calls) {
      const r = await runTool({ q: q(), version: "v2" }, parseToolCall(c));
      const d = r.data as Record<string, unknown> & { citable: string[] };
      const keys = contextKeys(d as Json);
      expect(d.citable.length, c.tool).toBeGreaterThan(0);
      for (const f of d.citable) {
        expect(fieldInContext(f, keys), `${c.tool} ${f}`).toBe(true);
        const v = f.split(/\.(?![^[]*\])/).reduce<unknown>((o, k) => {
          const m = /^(\w+)\[(\w+)=([^\]]+)\]$/.exec(k);
          if (m) return ((o as Record<string, unknown>)[m[1]!] as Record<string, unknown>[]).find((x) => x[m[2]!] === m[3]);
          return (o as Record<string, unknown>)[k];
        }, d);
        expect(typeof v, `${c.tool} ${f}`).toBe("number");
      }
    }
  });

  it("v1(기본)은 라벨·citable이 없다 — answer/v1~v3 카세트 그대로", async () => {
    const r = await runTool({ q: q() }, parseToolCall({ tool: "get_statement", args: { ym: "202608" } }));
    expect(r.data).not.toHaveProperty("statusLabel");
    expect(r.data).not.toHaveProperty("citable");
  });

  it("get_limit: 단계·분급 상태·사유 라벨", async () => {
    const r = await runTool({ q: q(), version: "v2" }, parseToolCall({ tool: "get_limit", args: { policyNo: "0001" } }));
    const d = r.data as { ledger: Record<string, unknown>; deferrals: Record<string, unknown>[] };
    expect(d.ledger.stageLabel).toBe("한도 소진");
    expect(d.deferrals[0]).toMatchObject({ statusLabel: expect.any(String), reasonLabel: expect.any(String) });
  });

  it("미등록 코드는 원문 대신 '미등록 사유', unregistered 수가 남는다", async () => {
    await env.DB.prepare("UPDATE earnings_line_a SET comm_type = 'NEW_BONUS' WHERE calc_id = 'c6'").run();
    const r = await runTool({ q: q(), version: "v2" }, parseToolCall({ tool: "get_statement", args: { ym: "202609" } }));
    const d = r.data as { lines: Record<string, unknown>[]; byType: Record<string, number>; byTypeLabel: Record<string, string> };
    expect(JSON.stringify(d.lines)).not.toContain("NEW_BONUS");
    expect(d.lines.find((l) => l.calcId === "c6")).toMatchObject({ commType: "미등록 사유", commTypeLabel: "미등록 사유" });
    expect(d.byTypeLabel.NEW_BONUS).toBe("미등록 사유");
    expect(r.unregistered).toBe(2);
  });
});

describe("answer/v4 파이프라인(v0.1.44 §4.4)", () => {
  it("본문은 라벨, 인용은 코드 경로(byType.FY_COMM·lines[calcId=c2]) — G6는 본문만 본다", async () => {
    const d = deps(out({ toolCalls: [tc("get_statement", { ym: "202608" })] }), () =>
      out({
        text: "2026년 8월 초년도 수수료와 시책이 지급되었고, 시책 중 200,000원은 한도 초과분 삭감입니다.",
        numbersUsed: ["2026년 8월", "200,000원"],
        citations: [
          { kind: "tool", tool: "get_statement", field: "byType.FY_COMM", article: "", chunkId: "" },
          { kind: "tool", tool: "get_statement", field: "lines[calcId=c2].limitCutAmt", article: "", chunkId: "" },
        ],
      }),
    );
    const r = await answerQuestion(d, q(), ENV, "8월 시책 왜 깎였어?");
    expect(r.violations).toEqual([]);
    expect(r).toMatchObject({ refused: false, groundingStatus: "PASS", llmCalls: 2 });
    // 2단계 요청에는 툴 목록·<session>이 없다
    expect(d.seen[1]!.messages[0]!.content).not.toContain("<session>");
  });

  it("RULES_UNAVAILABLE은 규정 검색이 실패했을 때만 받는다 — 1단계에서 끝", async () => {
    const refuse = out({ refused: true, reason: "RULES_UNAVAILABLE" });
    const down = await answerQuestion(deps(refuse, undefined, { embedFails: true }), q(), ENV, "한도 산식이 뭔가요?");
    expect(down).toMatchObject({ refused: true, reason: "RULES_UNAVAILABLE", text: REFUSAL_TEXT.RULES_UNAVAILABLE, rulesUnavailable: true, llmCalls: 1 });
    const up = await answerQuestion(deps(refuse), q(), ENV, "한도 산식이 뭔가요?");
    expect(up).toMatchObject({ refused: true, reason: "NOT_GROUNDED", groundingStatus: "FAIL" });
    expect(up.grounding.g1Shape).toContain("SHAPE:reason");
  });

  it("RULES_UNAVAILABLE 거부 행은 답 단위 재사용 대상이 아니다", async () => {
    const r = await answerQuestion(deps(out({ refused: true, reason: "RULES_UNAVAILABLE" }), undefined, { embedFails: true }), q(), ENV, "환수율 알려줘");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM answer_log WHERE answer_id = ?").bind(r.answerId).first<{ n: number }>();
    expect(n?.n).toBe(1);
    expect(await q().reusableAnswer("환수율 알려줘", "answer/v4", "2026-11-15T00:00:00Z")).toBeNull();
  });

  it("다른 설계사 ID 가드: LLM·임베딩 없이 OTHER_AGENT, 본인 ID만 있으면 걸리지 않는다", async () => {
    const d = deps(out({ text: "x" }));
    const r = await answerQuestion(d, q(), ENV, "A-1009 설계사 8월 수수료 보여줘");
    expect(r).toMatchObject({ refused: true, reason: "OTHER_AGENT", provider: "none", text: REFUSAL_TEXT.OTHER_AGENT });
    expect(d.seen).toHaveLength(0);
    expect(otherAgentIds("A-1001 내 수수료", "A-1001")).toEqual([]);
    expect(otherAgentIds("A-1001과 A-1002 비교", "A-1001")).toEqual(["A-1002"]);
  });

  it("인자 거부도 결과로: 2단계가 choices(마스킹 증권번호)를 받는다, 진단 TOOL_ARG_REJECTED는 남는다", async () => {
    let seenData: unknown[] = [];
    const d = deps(out({ toolCalls: [tc("get_limit", { policyNo: "#?" })] }), (data) => {
      seenData = data;
      return out({ text: "어느 계약인지 알려 주세요 — 0001 계약 또는 0002 계약입니다.", numbersUsed: [] });
    });
    const r = await answerQuestion(d, q(), ENV, "깎인 돈 언제 받아요?");
    expect(seenData[0]).toMatchObject({ tool: "get_limit", result: { rejected: true, choices: ["*********0001", "*********0002"] } });
    expect(r.llmCalls).toBe(2);
    expect(r.violations).toEqual([]);
    expect(r.groundingStatus).toBe("PASS");
  });

  it("맞는 계약이 없는 get_limit(found=false·후보 0)도 v2면 choices가 붙는다", async () => {
    const r = await runTool({ q: q(), version: "v2" }, parseToolCall({ tool: "get_limit", args: { policyNo: "9876" } }));
    expect(r.data).toMatchObject({ found: false, candidates: [], choices: ["*********0001", "*********0002"] });
  });
});

describe("2단계 툴 결과 합계 예산(설계서 v0.1.48 — fitStage2)", () => {
  const call = (ym: string) => runTool({ q: q(), version: "v2" }, parseToolCall({ tool: "get_statement", args: { ym } }));

  it("예산 안이면 그대로", async () => {
    const rs = [await call("202608")];
    const f = await fitStage2({ q: q(), version: "v2" }, rs, { fixedText: "짧은 본문", stage1Tokens: 3000 });
    expect(f.shrunk).toEqual([]);
    expect(f.results[0]).toBe(rs[0]);
  });

  it("넘으면 가장 큰 결과의 목록을 줄여 다시 부른다(Shown/Total) — 질문당 상한에서 1단계 실사용과 2단계 출력 몫을 뺀다", async () => {
    const rs = [await call("202608")];
    const fixedText = "본".repeat(300);
    const dataT = estimateTokens(dataBlock(rs));
    // 결과 예산이 지금 결과보다 작아지게 1단계 사용량을 잡는다
    const stage1Tokens = QUESTION_MAX_TOKENS - STAGE2_OUTPUT_RESERVE - PROMPT_OVERHEAD_TOKENS - estimateTokens(fixedText) - Math.floor(dataT / 2);
    const f = await fitStage2({ q: q(), version: "v2" }, rs, { fixedText, stage1Tokens });
    expect(f.budget).toBe(Math.floor(dataT / 2));
    expect(f.shrunk.length).toBeGreaterThan(0);
    expect(f.results[0]!.tokens).toBeLessThan(rs[0]!.tokens);
    expect(f.results[0]!.data).toMatchObject({ linesShown: expect.any(Number), linesTotal: (rs[0]!.data as { lines: unknown[] }).lines.length });
    // 줄인 결과도 v2 — citable은 남은 숫자 잎만
    expect((f.results[0]!.data as { citable: string[] }).citable.every((c) => !/[{}<>…]/.test(c))).toBe(true);
  });

  it("호출당 상한만(1단계 usage 없음)일 때도 같은 규칙, 머리만 남아도 넘으면 그대로 둔다(멈춘다)", async () => {
    const rs = [await call("202608")];
    const f = await fitStage2({ q: q(), version: "v2" }, rs, { fixedText: "본".repeat(4000), stage1Tokens: null });
    expect(f.budget).toBeLessThan(0);
    expect(f.results).toHaveLength(1);
  });
});

