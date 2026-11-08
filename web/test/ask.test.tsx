import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type AnswerReplay, type AskResult, api, HumanCheckRequired, type Me, RateLimited, withAskBudget } from "../src/api";
import { App } from "../src/App";
import { EXAMPLE_QUESTIONS } from "../src/examples";
import { waitText } from "../src/format";
import { match } from "../src/router";
import { Chips } from "../src/ui";
import { AnswerCard, humanCheckNeeded } from "../src/screens/Ask";
import { HumanCheck, TURNSTILE_SCRIPT } from "../src/screens/HumanCheck";
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
  violations: { g1Shape: [], g4Missing: [], g5Unknown: [], g6Words: [] },
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
    const violations = { g1Shape: [], g4Missing: ["200,000", "numbersUsed:200,000"], g5Unknown: ["get_statement.byType.CLAWBACK"], g6Words: ["CODE:FY_COMM"] };
    const html = renderToStaticMarkup(<ReplayTimeline a={{ ...replay, refused: true, reason: "NOT_GROUNDED", groundingStatus: "FAIL", answer: "근거 고정 문구", numbersUsed: [], citations: [], violations }} />);
    expect(html).toContain("근거로 확인되지 않음");
    expect(html).toContain("근거 고정 문구");
    expect(html).toContain("모델이 쓴 원문은 남기지 않는다");
    expect(html).toContain("검증 실패");
    for (const t of ["G4 근거에 없는 숫자", "G5 확인되지 않은 인용", "G6 금지 표현·코드"]) expect(html).toContain(t);
    expect(html.match(/chip violation/g)).toHaveLength(4);
    for (const t of [...violations.g4Missing, ...violations.g5Unknown, ...violations.g6Words]) expect(html).toContain(`>${t}</li>`);
  });

  it("모양 오류 칩(설계서 v0.1.26): 사유 코드별 문구 + 코드 원문", () => {
    const html = renderToStaticMarkup(
      <ReplayTimeline a={{ ...replay, refused: true, reason: "NOT_GROUNDED", groundingStatus: "FAIL", violations: { g1Shape: ["EMPTY_BODY", "TOOL_IN_STAGE2:get_deferrals", "SHAPE:citations", "TOOL_ARG_REJECTED:get_limit"], g4Missing: [], g5Unknown: [], g6Words: [] } }} />,
    );
    expect(html).toContain("G1 모양 오류");
    for (const t of ["모양 오류 · 빈 본문", "모양 오류 · 2단계 툴 요청", "모양 오류 · 응답 모양", "모양 오류 · 툴 인자 거부", "TOOL_IN_STAGE2:get_deferrals"]) expect(html).toContain(t);
    expect(html).not.toContain("위반 없음");
  });

  it("위반 없음·0006 이전 답변(null)", () => {
    expect(renderToStaticMarkup(<ReplayTimeline a={replay} />)).toContain("위반 없음(G1·G4·G5·G6)");
    expect(renderToStaticMarkup(<ReplayTimeline a={{ ...replay, violations: null }} />)).toContain("0006 이전");
  });
});

describe("화면 4 사람 확인·분당 한도(설계서 v0.1.29 — PHASES Phase 5 항목 5)", () => {
  it("HumanCheck: 안내 문구와 위젯 자리, 스크립트는 Turnstile 공식 경로(명시적 렌더)", () => {
    const html = renderToStaticMarkup(<HumanCheck siteKey="0x4AAAAAAF2LyuLvbqeCCVE5" onVerified={() => {}} />);
    expect(html).toContain('data-testid="human-check"');
    expect(html).toContain("사람 확인");
    expect(TURNSTILE_SCRIPT).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  });

  it("api.ask: 403 → HumanCheckRequired, problem+json 429 → RateLimited(Retry-After), 본문 429(BUDGET)는 거부 답 그대로", async () => {
    const reply = (status: number, body: object, headers: Record<string, string> = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
    vi.stubGlobal("fetch", reply(403, { code: "TURNSTILE_REQUIRED", message: "사람 확인을 먼저 마치세요" }, { "Content-Type": "application/problem+json" }));
    await expect(api.ask("q")).rejects.toBeInstanceOf(HumanCheckRequired);
    vi.stubGlobal("fetch", reply(429, { code: "RATE_LIMITED", message: "m" }, { "Content-Type": "application/problem+json", "Retry-After": "17" }));
    await expect(api.ask("q")).rejects.toMatchObject({ retryAfterSeconds: 17 });
    await expect(api.ask("q")).rejects.toBeInstanceOf(RateLimited);
    vi.stubGlobal("fetch", reply(429, { ...pass, refused: true, reason: "BUDGET", retryAfterSeconds: 100 }, { "Content-Type": "application/json" }));
    expect((await api.ask("q")).reason).toBe("BUDGET");
    vi.stubGlobal("fetch", reply(403, {}));
    await expect(api.turnstile("tok")).rejects.toBeInstanceOf(HumanCheckRequired);
    vi.unstubAllGlobals();
  });
});

describe("사람 확인 다시 받기(설계서 v0.1.31 — 쿠키가 IP에 묶여 망이 바뀌면 다시 확인)", () => {
  const t = (verified: boolean) => ({ required: true, verified, siteKey: "0x4AAAAAAF2LyuLvbqeCCVE5" });
  it("불러온 verified를 따르고, 이 화면에서 마치면 숨고, /ask 403(만료·IP 바뀜) 뒤에는 다시 그린다", () => {
    expect(humanCheckNeeded(t(false), null)).toBe(true); // 첫 방문
    expect(humanCheckNeeded(t(false), true)).toBe(false); // 이 화면에서 마침
    expect(humanCheckNeeded(t(true), null)).toBe(false); // 24시간 쿠키가 있다
    expect(humanCheckNeeded(t(true), false)).toBe(true); // 쿠키는 있었지만 /ask 403(망 전환으로 IP가 바뀜)
    expect(humanCheckNeeded(t(false), false)).toBe(true);
    // 검사하지 않는 환경(비밀 없음)·사이트 키 없음은 그리지 않는다
    expect(humanCheckNeeded({ required: false, verified: true }, false)).toBe(false);
    expect(humanCheckNeeded({ required: true, verified: false }, null)).toBe(false);
    expect(humanCheckNeeded(undefined, null)).toBe(false);
  });
});

describe("상단 칩 — /ask 응답의 남은 질문으로(설계서 v0.1.33, /me 다시 부르지 않음)", () => {
  const me: Me = { ...common, agentId: "A-1001", promptVersions: { answer: "v3" }, budget: { remainingToday: 35, userRemaining: 10, resetsAt: "2026-11-08T00:00:00.000Z" } };
  const chip = (latest?: { remainingToday: number; userRemaining: number }) => {
    const html = renderToStaticMarkup(<Chips asOf={asOf} me={{ ...me, budget: withAskBudget(me.budget, latest) }} />);
    return /data-testid="chip-budget">([^<]*)</.exec(html)![1];
  };

  it("답 1건 뒤 칩이 1 준다(200 응답 budget), 응답이 없으면 /me 값, resetsAt은 /me 것", async () => {
    expect(chip()).toBe("오늘 남은 질문 10회");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...pass, budget: { remainingToday: 34, userRemaining: 9 } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const r = await api.ask("8월 시책은?");
    expect(chip(r.budget)).toBe("오늘 남은 질문 9회");
    expect(withAskBudget(me.budget, r.budget)?.resetsAt).toBe("2026-11-08T00:00:00.000Z");
    vi.unstubAllGlobals();
  });

  it("429 뒤에도 칩 = 응답 값 — BUDGET(본문 budget)·RATE_LIMITED(problem 본문 budget)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...pass, refused: true, reason: "BUDGET", retryAfterSeconds: 100, budget: { remainingToday: 30, userRemaining: 0 } }), { status: 429, headers: { "Content-Type": "application/json" } })));
    const b = await api.ask("q");
    expect(chip(b.budget)).toBe("오늘 남은 질문 0회");
    expect(renderToStaticMarkup(<Chips asOf={asOf} me={{ ...me, budget: withAskBudget(me.budget, b.budget) }} />)).toContain('class="chip warn"');
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "RATE_LIMITED", message: "m", budget: { remainingToday: 31, userRemaining: 7 } }), { status: 429, headers: { "Content-Type": "application/problem+json", "Retry-After": "20" } })));
    const e = (await api.ask("q").catch((x: unknown) => x)) as RateLimited;
    expect(e).toBeInstanceOf(RateLimited);
    expect([e.retryAfterSeconds, e.budget]).toEqual([20, { remainingToday: 31, userRemaining: 7 }]);
    expect(chip(e.budget)).toBe("오늘 남은 질문 7회");
    vi.unstubAllGlobals();
  });
});
