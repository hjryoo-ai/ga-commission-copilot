import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnswerReplay, AskResult } from "../src/api";
import { App } from "../src/App";
import { EXAMPLE_QUESTIONS } from "../src/examples";
import { waitText } from "../src/format";
import { match } from "../src/router";
import { AnswerCard } from "../src/screens/Ask";
import { promptHref, ReplayTimeline } from "../src/screens/AnswerReplay";

// PHASES Phase 4 항목 5 — 화면 4(자유 질문)·7(답변 재현). LLM을 부르지 않는다: 응답 모양을 손으로 만든 정적 렌더.
const asOf = { streamHash: "f".repeat(64), generatedAt: "2026-10-26T00:00:00Z", demoNo: 1 as const };
const common = { asOf, dataStatus: "OK" as const, disclaimer: "가상 데모 데이터 · 설계사 참고용 · 비확정 · 고객 제시 불가" };
const ID = "0f0e0d0c-0b0a-4000-8000-000000000001";

const pass: AskResult = {
  ...common,
  answerId: ID,
  refused: false,
  reason: null,
  text: "8월 시책 1,000,000원 중 145,000원이 한도로 이연되어 855,000원이 지급되었습니다.",
  promptVersion: "answer/v3",
  numbersUsed: ["1,000,000원", "145,000원", "855,000원"],
  citations: [
    { kind: "tool", tool: "get_statement", field: "byType.INCENTIVE", article: "", chunkId: "" },
    { kind: "rule", tool: "", field: "", article: "제7조", chunkId: "rb-07" },
  ],
  toolCalls: [{ tool: "get_statement", args: { ym: "202608" }, resultHash: "aa096ae6a197d2e3" }],
  provider: "groq",
  model: "openai/gpt-oss-120b",
  groundingStatus: "PASS",
  cacheHit: false,
  latencyMs: 2345,
};

describe("화면 4 자유 질문", () => {
  it("경로 /me/ask·/answers/{uuid}, 틀린 id는 notFound", () => {
    expect(match("/me/ask")).toEqual({ name: "ask" });
    expect(match(`/answers/${ID}`)).toEqual({ name: "answer", answerId: ID });
    expect(match("/answers/abc")).toEqual({ name: "notFound" });
  });

  it("입력창·예시 질문 칩 6개(부록 A 원문)·탭에 질문", () => {
    const html = renderToStaticMarkup(<App path="/me/ask" />);
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="500"');
    expect(EXAMPLE_QUESTIONS).toHaveLength(6);
    for (const x of EXAMPLE_QUESTIONS) expect(html).toContain(x.question);
    expect(html).toContain('href="/me/ask"');
  });

  it("답변 카드: 검증 배지·본문·고정 문구·인용(툴 필드·조항)·툴 호출 펼침·공급자·모델·지연·재현 링크", () => {
    const html = renderToStaticMarkup(<AnswerCard r={pass} />);
    expect(html).toContain("검증 통과");
    expect(html).toContain("855,000원이 지급되었습니다");
    expect(html).toContain(common.disclaimer);
    expect(html).toContain("get_statement · byType.INCENTIVE");
    expect(html).toContain("제7조(rb-07)");
    expect(html).toContain("툴 호출 1건");
    expect(html).toContain("get_statement(ym=202608) · aa096ae6a197d2e3");
    expect(html).toContain("groq · openai/gpt-oss-120b · 2345ms");
    expect(html).toContain(`href="/answers/${ID}"`);
    expect(renderToStaticMarkup(<AnswerCard r={{ ...pass, rulesUnavailable: true }} />)).toContain("규정 검색을 쓸 수 없어");
  });

  it("거부 카드: 사유 라벨(영문 코드 없음)·서버 고정 문구 그대로·대안 동선, 본문 숫자·인용 없음", () => {
    const cases = [
      ["NOT_GROUNDED", "근거로 확인되지 않음", 'href="/me/limits"'],
      ["OTHER_AGENT", "다른 설계사 정보", "내 명세 보기"],
      ["NEEDS_ENGINE", "엔진 계산이 필요한 질문", "한도 현황"],
      ["OUT_OF_SCOPE", "답할 수 있는 범위 밖", "예시 질문처럼"],
    ] as const;
    for (const [reason, label, alt] of cases) {
      const html = renderToStaticMarkup(<AnswerCard r={{ ...common, answerId: ID, refused: true, reason, text: `고정 문구 ${reason}`, promptVersion: "answer/v3", groundingStatus: "NONE" }} />);
      expect(html, reason).toContain(label);
      expect(html, reason).toContain(`고정 문구 ${reason}`);
      expect(html, reason).toContain(alt);
      expect(html.replace(`고정 문구 ${reason}`, ""), reason).not.toMatch(/OUT_OF_SCOPE|NOT_GROUNDED|OTHER_AGENT|NEEDS_ENGINE/);
      expect(html, reason).not.toContain("인용");
    }
  });

  it("예산 소진(429 BUDGET): 남은 시간·사전 생성 설명 안내", () => {
    const html = renderToStaticMarkup(<AnswerCard r={{ ...common, answerId: ID, refused: true, reason: "BUDGET", text: "오늘의 질문 예산이 소진되었습니다.", promptVersion: "answer/v3", retryAfterSeconds: 3 * 3600 + 301 }} />);
    expect(html).toContain("오늘 질문 예산 소진");
    expect(html).toContain("3시간 6분 뒤(00:00 UTC)");
    expect(html).toContain("사전 생성 설명은 계속");
    expect([waitText(59), waitText(60), waitText(3600), waitText(86_400)]).toEqual(["1분", "1분", "1시간 0분", "24시간 0분"]);
  });
});

const replay: AnswerReplay = {
  ...common,
  answerId: ID,
  question: "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?",
  normalizedQuestion: "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요",
  answer: pass.text,
  refused: false,
  reason: null,
  groundingStatus: "PASS",
  numbersUsed: pass.numbersUsed!,
  citations: pass.citations!,
  violations: { g4Missing: [], g5Unknown: [], g6Words: [] },
  retrievedChunks: [
    { chunkId: "rb-07", score: 0.7123, article: "제7조", title: "한도", body: "가상 규정 · 예시값 — 한도 본문", version: "0453f7d205db" },
    { chunkId: "rb-99", score: 0.5 },
  ],
  toolCalls: [
    { tool: "get_statement", args: { ym: "202608" }, resultHash: "aa096ae6a197d2e3", result: { closeYm: "202608" }, truncated: false, reproduced: true },
    { tool: "get_limit", args: { policyNo: "0001" }, resultHash: "10b4df4c0b952aa9", reproduced: false },
  ],
  promptVersion: "answer/v3",
  provider: "groq",
  model: "openai/gpt-oss-120b",
  fallbackDepth: 0,
  latencyMs: 2345,
  createdAt: "2026-11-04T12:27:00Z",
};

describe("화면 7 답변 재현", () => {
  it("세로 타임라인 7단계 순서: 질문 → 정규화 → 검색 청크 → 툴 → 프롬프트 → 모델 출력 → 검증", () => {
    const html = renderToStaticMarkup(<ReplayTimeline a={replay} />);
    const order = ["질문", "정규화", "검색 청크 2건", "툴 호출 2건", "프롬프트", "모델 출력", "검증 결과"].map((t) => html.indexOf(`</span> ${t}</h3>`));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("청크 점수·본문(없으면 본문 없음), 툴 재현 일치/불일치 배지·다시 실행한 결과, 프롬프트 링크", () => {
    const html = renderToStaticMarkup(<ReplayTimeline a={replay} />);
    expect(html).toContain("제7조 한도");
    expect(html).toContain("점수 0.712");
    expect(html).toContain("rb-99");
    expect(html).toContain("본문 없음");
    expect(html).toContain("재현 일치");
    expect(html).toContain("재현 불일치");
    expect(html).toContain("지금 다시 실행한 결과");
    expect(html).toContain('href="https://github.com/hjryoo-ai/ga-commission-copilot/blob/main/prompts/answer/v3.md"');
    expect([promptHref("answer/v3"), promptHref("../x"), promptHref("answer/3")]).toEqual(["https://github.com/hjryoo-ai/ga-commission-copilot/blob/main/prompts/answer/v3.md", null, null]);
  });

  it("거부·검증 실패: 고정 문구, 원문 없음 안내, 위반 토큰을 종류별로 하나씩(설계서 v0.1.25)", () => {
    const violations = { g4Missing: ["200,000", "numbersUsed:200,000"], g5Unknown: ["get_statement.byType.CLAWBACK"], g6Words: ["CODE:FY_COMM"] };
    const html = renderToStaticMarkup(<ReplayTimeline a={{ ...replay, refused: true, reason: "NOT_GROUNDED", groundingStatus: "FAIL", answer: "근거 고정 문구", numbersUsed: [], citations: [], violations }} />);
    expect(html).toContain("근거로 확인되지 않음");
    expect(html).toContain("근거 고정 문구");
    expect(html).toContain("모델이 쓴 원문은 남기지 않는다");
    expect(html).toContain("검증 실패");
    for (const t of ["G4 근거에 없는 숫자", "G5 확인되지 않은 인용", "G6 금지 표현·코드"]) expect(html).toContain(t);
    expect(html.match(/chip violation/g)).toHaveLength(4);
    for (const t of [...violations.g4Missing, ...violations.g5Unknown, ...violations.g6Words]) expect(html).toContain(`>${t}</li>`);
  });

  it("위반 없음·0006 이전 답변(null)", () => {
    expect(renderToStaticMarkup(<ReplayTimeline a={replay} />)).toContain("위반 없음(G4·G5·G6)");
    expect(renderToStaticMarkup(<ReplayTimeline a={{ ...replay, violations: null }} />)).toContain("0006 이전");
  });
});
