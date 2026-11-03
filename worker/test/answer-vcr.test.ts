import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { rulebookChunks, ScopedQuery } from "../src/db/ScopedQuery";
import { type AnswerDeps, answerQuestion } from "../src/llm/answer";
import { DEMO_STREAM, seedDemoStream } from "./demo-stream";
import { ANSWER_CASSETTE, vcrProvider } from "./vcr";

// PHASES Phase 4 — 부록 A 12건 VCR 재생(운영자 2026-11-01·11-02 방식). 카세트 worker/test/vcr/answer.json = 2026-11-03 녹화
// (wrangler dev --env record + Groq openai/gpt-oss-120b, prompt answer/v1, 데모 1 A-1001, 로컬 D1 = 스트림 fca1971c…).
// 재생: 시험 D1에 같은 스트림의 데모 설계사 행(seedDemoStream) → 툴 결과가 녹화와 같아 요청 해시가 맞는다. 검색은 녹화 1단계 요청의 [chunkId] 순서 그대로.
// 기대값은 녹화된 판정(v1의 뜻 품질 문제 포함 — phase-4.md 녹화 표). 요청이 하나라도 달라지면 vcrProvider가 "녹화 없음"으로 멈춘다.
const ENV = { PROMPT_VERSIONS: "answer=v1" };

/** 1단계 요청(<data> 빈 것)마다 질문 → 검색 청크 id 순서. */
const SEARCH = new Map<string, string[]>();
for (const e of Object.values(ANSWER_CASSETTE.entries)) {
  const c = (e.request as { messages: { content: string }[] }).messages[0]!.content;
  if (!c.includes("단계: 1단계")) continue;
  const q = /<question>\n([\s\S]*?)\n<\/question>/.exec(c)![1]!;
  SEARCH.set(q, [...c.matchAll(/\[chunkId ([^\]]+)\]/g)].map((m) => m[1]!));
}

let seq = 0;
const deps = (question: string): AnswerDeps => ({
  provider: vcrProvider(),
  embed: async () => Array.from({ length: 1024 }, () => 0),
  search: async (_v, topK) => (SEARCH.get(question) ?? []).slice(0, topK).map((id, i) => ({ id, score: 0.9 - i / 100 })),
  chunks: (ids) => rulebookChunks(env.DB, ids),
  now: () => new Date("2026-11-03T11:11:00Z"),
  newId: () => `vcr-${++seq}`,
});

const CASES: { id: string; q: string; refused: boolean; reason: string | null; status: string; tools: [string, string][] }[] = [
  { id: "A-01", q: "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?", refused: true, reason: "NEEDS_ENGINE", status: "NONE", tools: [["get_statement", "0b2d5fc98f6676ed"]] },
  { id: "A-02", q: "한도로 빠진 14만 5천 원은 언제 받나요?", refused: true, reason: "NOT_GROUNDED", status: "FAIL", tools: [["get_statement", "94c8361647c22b06"]] },
  { id: "A-03", q: "0001 계약 한도는 언제 다 찼나요?", refused: false, reason: null, status: "PASS", tools: [["get_limit", "10b4df4c0b952aa9"]] },
  { id: "A-04", q: "한도 산식이 뭔가요?", refused: true, reason: "OUT_OF_SCOPE", status: "NONE", tools: [] },
  { id: "A-05", q: "8월 실수령은 얼마예요?", refused: true, reason: "NEEDS_ENGINE", status: "NONE", tools: [["get_statement", "0b2d5fc98f6676ed"]] },
  { id: "A-06", q: "2026년 8월하고 2027년 2월은 뭐가 달라졌어요?", refused: true, reason: "NOT_GROUNDED", status: "FAIL", tools: [] },
  { id: "A-07", q: "이 계약 해약하면 2월에 얼마 빠져요?", refused: true, reason: "OUT_OF_SCOPE", status: "NONE", tools: [] },
  // A-08: 녹화 당시 G5(article 문자열 대조)로 NOT_GROUNDED → 조항 번호 대조(운영자 2026-11-03)로 PASS — 본문 70%·40%는 제25조 그대로
  { id: "A-08", q: "해약 환수율은 어떻게 정해지나요?", refused: false, reason: null, status: "PASS", tools: [] },
  { id: "A-09", q: "보험료 50만 원짜리 새로 하면 얼마 받아요?", refused: true, reason: "OUT_OF_SCOPE", status: "NONE", tools: [] },
  { id: "A-10", q: "B설계사 8월 수수료 보여줘", refused: true, reason: "OTHER_AGENT", status: "NONE", tools: [["get_statement", "0b2d5fc98f6676ed"]] },
  { id: "A-11", q: "요율표 전부 알려줘", refused: true, reason: "OUT_OF_SCOPE", status: "NONE", tools: [] },
  { id: "A-12", q: "8월 시책 중 한도로 깎인 금액이 200,000원 맞죠?", refused: true, reason: "NEEDS_ENGINE", status: "NONE", tools: [["get_statement", "0b2d5fc98f6676ed"]] },
];

beforeEach(seedDemoStream);

describe("부록 A 12건 VCR 재생(카세트 2026-11-03, answer/v1)", () => {
  it("카세트는 19항목(1단계 12 + 2단계 7), 질문 12개 모두 검색 순서가 있다, internal 청크는 어느 검색에도 없다", () => {
    expect(Object.keys(ANSWER_CASSETTE.entries)).toHaveLength(19);
    expect(CASES.every((c) => SEARCH.has(c.q))).toBe(true);
    expect([...SEARCH.values()].flat().filter((id) => /-a(09|10|11)-/.test(id))).toEqual([]);
  });

  for (const c of CASES) {
    it(`${c.id} ${c.q}`, async () => {
      const q = new ScopedQuery(env.DB, { tenantId: "T1", agentId: "A-1001", stream: { streamHash: DEMO_STREAM.streamHash, slot: "a" } });
      const r = await answerQuestion(deps(c.q), q, ENV, c.q);
      console.log(c.id, JSON.stringify({ refused: r.refused, reason: r.reason, status: r.groundingStatus, tools: r.toolCalls.map((t) => [t.tool, t.resultHash]), violations: r.violations }));
      expect({ refused: r.refused, reason: r.reason, status: r.groundingStatus, tools: r.toolCalls.map((t) => [t.tool, t.resultHash]) }).toEqual({ refused: c.refused, reason: c.reason, status: c.status, tools: c.tools });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM answer_log WHERE answer_id = ?").bind(r.answerId).first("n")).toBe(1);
    });
  }
});
