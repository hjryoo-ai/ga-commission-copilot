import { describe, expect, it, vi } from "vitest";
import { loadPrompt } from "../src/llm/promptRegistry";
import {
  FALLBACK_TIMEOUT_MS,
  errorDetail,
  failureKind,
  fallbackChain,
  groq,
  groq429Stub,
  openrouter,
  type Provider,
  ProviderError,
  type ProviderName,
  ProvidersExhausted,
  ProvidersFailed,
  type StructuredRequest,
  TIMEOUT_MS,
  WORKERS_AI_MAX_TOKENS,
  WORKERS_AI_MODEL,
  workersAi,
  workersAiContent,
} from "../src/llm/providers";

// PHASES Phase 5 항목 2·7 — 폴백 체인(설계서 v0.1.27 §6.2): 429·5xx·타임아웃이면 다음, 시도 최대 2개, 상한 0인 공급자는 건너뛰고 세지 않는다.
const REQ: StructuredRequest = { model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "q" }], schemaName: "answer", schema: { type: "object" }, maxCompletionTokens: 100 };

/** 순서대로 결과를 내는 가짜 공급자 — Error면 던진다. */
function stub(name: ProviderName, outcome: object | Error): Provider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async structured() {
      p.calls++;
      if (outcome instanceof Error) throw outcome;
      return { json: outcome, provider: name, model: `${name}-model`, usage: null };
    },
  };
  return p;
}

const allow = (deny: ProviderName[] = []) => {
  const seen: ProviderName[] = [];
  const reserve = async (n: ProviderName) => {
    seen.push(n);
    return !deny.includes(n);
  };
  return { reserve, seen };
};

describe("폴백 체인", () => {
  it("1순위 성공: depth 0, 다음 공급자는 예산도 건드리지 않는다", async () => {
    const [g, w, o] = [stub("groq", { a: 1 }), stub("workers-ai", { a: 2 }), stub("openrouter", { a: 3 })];
    const { reserve, seen } = allow();
    const r = await fallbackChain([g, w, o], reserve).structured(REQ);
    expect([r.provider, r.fallbackDepth, r.json]).toEqual(["groq", 0, { a: 1 }]);
    expect(seen).toEqual(["groq"]);
  });

  it("Groq 429 → Workers AI: depth 1", async () => {
    const [g, w, o] = [stub("groq", new ProviderError("groq 429", 429, 30)), stub("workers-ai", { ok: true }), stub("openrouter", { a: 3 })];
    const r = await fallbackChain([g, w, o], allow().reserve).structured(REQ);
    expect([r.provider, r.fallbackDepth]).toEqual(["workers-ai", 1]);
    expect(o.calls).toBe(0);
  });

  it("Groq 5xx + Workers AI 상한 0(배치 중) → OpenRouter: depth 2, Workers AI는 시도에 세지 않는다", async () => {
    const [g, w, o] = [stub("groq", new ProviderError("groq 503", 503)), stub("workers-ai", { a: 2 }), stub("openrouter", { ok: true })];
    const { reserve, seen } = allow(["workers-ai"]);
    const r = await fallbackChain([g, w, o], reserve).structured(REQ);
    expect([r.provider, r.fallbackDepth]).toEqual(["openrouter", 2]);
    expect([w.calls, seen]).toEqual([0, ["groq", "workers-ai", "openrouter"]]);
  });

  it("시도는 최대 2개: 둘 다 타임아웃이면 마지막 오류를 던지고 3번째는 예산도 부르지 않는다", async () => {
    const [g, w, o] = [stub("groq", new ProviderError("t", 0)), stub("workers-ai", new ProviderError("w 502", 502)), stub("openrouter", { a: 3 })];
    const { reserve, seen } = allow();
    await expect(fallbackChain([g, w, o], reserve).structured(REQ)).rejects.toMatchObject({ status: 502 });
    expect([o.calls, seen]).toEqual([0, ["groq", "workers-ai"]]);
  });

  it("v0.1.34: 모두 실패하면 ProvidersFailed — 시도마다 공급자·순번·모델·종류(키·본문 없이), 400도 시도 목록과 함께", async () => {
    const [g, w, o] = [stub("groq", new ProviderError("groq 429", 429, 30)), stub("workers-ai", new ProviderError("workers-ai: 8000ms 타임아웃", 0)), stub("openrouter", { a: 3 })];
    const e = (await fallbackChain([g, w, o], allow().reserve).structured(REQ).catch((x: unknown) => x)) as ProvidersFailed;
    expect(e).toBeInstanceOf(ProvidersFailed);
    expect([e.status, e.attempts]).toEqual([
      0,
      [
        { provider: "groq", depth: 0, model: "openai/gpt-oss-120b", kind: "rate_limit" },
        { provider: "workers-ai", depth: 1, model: WORKERS_AI_MODEL, kind: "timeout" },
      ],
    ]);
    const bad = (await fallbackChain([stub("openrouter", new ProviderError("openrouter 400", 400))], allow().reserve).structured(REQ).catch((x: unknown) => x)) as ProvidersFailed;
    expect([bad.status, bad.attempts]).toEqual([400, [{ provider: "openrouter", depth: 0, model: "openrouter/free", kind: "http400" }]]);
  });

  it("failureKind: 상태·메시지 → 종류(Workers AI 4자리 코드는 ai_<코드>)", () => {
    const kinds = (
      [
        ["groq 429", 429],
        ["groq: 8000ms 타임아웃", 0],
        ["groq: 네트워크 오류", 0],
        ["workers-ai: 빈 응답", 502],
        ["openrouter: JSON 아님", 502],
        ["workers-ai: 알 수 없는 응답 모양", 502],
        ["workers-ai: AiGatewayError: bad", 502],
        ["workers-ai: 5006: Error: oneOf at '/' not met", 502],
        ["openrouter 503", 503],
        ["groq 400", 400],
      ] as const
    ).map(([m, s]) => failureKind(new ProviderError(m, s)));
    expect(kinds).toEqual(["rate_limit", "timeout", "other", "empty", "not_json", "shape", "gateway", "ai_5006", "upstream", "http400"]);
    // 4xx는 본문의 코드(없으면 종류)로 나눈다(운영자 2026-11-18 — stat:err:<공급자>:<종류>)
    expect(failureKind(new ProviderError("groq 400", 400, null, null, { type: "invalid_request_error", code: "json_validate_failed", message: null }))).toBe("http400_json_validate_failed");
    expect(failureKind(new ProviderError("groq 413", 413, null, null, { type: "Invalid Request Error", code: null, message: null }))).toBe("http413_invalid_request_error");
  });

  it("errorDetail: 종류·코드·메시지만 — failed_generation은 읽지 않고, 메시지 안 따옴표·{…}·[…] 조각(모델 생성문일 수 있다)은 길이와 관계없이 지운다", () => {
    const gen = '{"refused":false,"text":"8월 시책은 1,000,000원이며 한도 초과분 145,000원은 이연되었습니다"}';
    const body = JSON.stringify({ error: { message: `Failed to generate JSON. Output: "짧은 생성문 3,000원" and ${gen} and [1, 2, "x"] and 'got 이연 금액 145,000' end`, type: "invalid_request_error", code: "json_validate_failed", failed_generation: gen } });
    const d = errorDetail(body)!;
    expect(d).toEqual({ type: "invalid_request_error", code: "json_validate_failed", message: `Failed to generate JSON. Output: "…" and {…} and {…} and '…' end` });
    for (const leak of ["145,000", "3,000", "1,000,000", "이연"]) expect(JSON.stringify(d)).not.toContain(leak);
    // 작은따옴표 스키마 위치는 그대로(Groq json_validate_failed 실측 꼴 — 2026-11-18 로컬 재현)
    const loc = "Generated JSON does not match the expected schema. Error: jsonschema: '/citations/0' does not validate with schema://answer#/properties/citations/items/required: missing properties: 'tool'";
    expect(errorDetail(JSON.stringify({ error: { message: loc } }))!.message).toBe(loc);
    expect(errorDetail("not json")).toBeNull();
    expect(errorDetail(JSON.stringify({ error: { message: "x".repeat(500) } }))!.message).toHaveLength(300);
  });

  it("시도할 공급자가 없으면 ProvidersExhausted(저하 ①), 400 같은 요청 오류는 폴백하지 않고 그대로", async () => {
    const [g, w, o] = [stub("groq", { a: 1 }), stub("workers-ai", { a: 2 }), stub("openrouter", { a: 3 })];
    await expect(fallbackChain([g, w, o], allow(["groq", "workers-ai", "openrouter"]).reserve).structured(REQ)).rejects.toBeInstanceOf(ProvidersExhausted);
    const bad = stub("groq", new ProviderError("groq 400", 400));
    const next = stub("workers-ai", { a: 2 });
    await expect(fallbackChain([bad, next], allow().reserve).structured(REQ)).rejects.toMatchObject({ status: 400 });
    expect(next.calls).toBe(0);
  });
});

describe("공급자", () => {
  const ok = (content: string) => new Response(JSON.stringify({ model: "m", choices: [{ message: { content } }], usage: { prompt_tokens: 1 } }), { status: 200 });

  it("Groq 400: 본문의 코드·메시지를 ProviderError에(failed_generation 없이), 폴백 대상 아님", async () => {
    const body = JSON.stringify({ error: { message: "Failed to generate JSON.", type: "invalid_request_error", code: "json_validate_failed", failed_generation: '{"text":"생성문"}' } });
    const e = (await groq({ GROQ_API_KEY: "k" }, async () => new Response(body, { status: 400 }))
      .structured(REQ)
      .catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError);
    // 운영 로그에 실리는 message는 공급자·상태·코드만(메시지 본문은 detail에만)
    expect([e.status, e.message, e.detail, e.rateLimit]).toEqual([400, "groq 400 json_validate_failed", { type: "invalid_request_error", code: "json_validate_failed", message: "Failed to generate JSON." }, null]);
    expect(e.message).not.toContain("생성문");
  });

  it("Groq·OpenRouter: 키 없으면 status 0(폴백 대상), 429는 retry-after와 함께, OpenRouter는 모델을 openrouter/free로 바꾼다", async () => {
    await expect(groq({}).structured(REQ)).rejects.toMatchObject({ status: 0 });
    await expect(groq({ GROQ_API_KEY: "k" }, async () => new Response("", { status: 429, headers: { "retry-after": "7" } })).structured(REQ)).rejects.toMatchObject({ status: 429, retryAfterS: 7 });
    let sent: { model?: string } = {};
    const r = await openrouter({ OPENROUTER_API_KEY: "k" }, async (_u, init) => {
      sent = JSON.parse(String(init?.body)) as { model?: string };
      return ok('{"x":1}');
    }).structured(REQ);
    expect([sent.model, r.provider, r.json]).toEqual(["openrouter/free", "openrouter", { x: 1 }]);
  });

  it("Workers AI: 응답 모양 둘 다(choices·response), 뉴런 소진(4006)은 429로, 바인딩 입력은 messages + json_schema + reasoning_effort low(설계서 v0.1.35 — 배치와 같게), 모양은 shape로", async () => {
    expect(workersAiContent({ choices: [{ message: { content: '{"a":1}' } }] })).toMatchObject({ json: { a: 1 }, shape: "choices" });
    expect(workersAiContent({ response: '{"a":2}' })).toMatchObject({ json: { a: 2 }, shape: "response:string" });
    expect(workersAiContent({ response: { a: 3 } })).toMatchObject({ json: { a: 3 }, shape: "response:object" });
    expect(() => workersAiContent({ foo: 1 })).toThrow(ProviderError);
    let input: Record<string, unknown> = {};
    const r = await workersAi({
      run: (async (model: string, i: Record<string, unknown>) => {
        expect(model).toBe(WORKERS_AI_MODEL);
        input = i;
        return { response: { ok: true } };
      }) as never,
    }).structured(REQ);
    expect([r.provider, r.model, r.json, r.shape, r.viaGateway]).toEqual(["workers-ai", WORKERS_AI_MODEL, { ok: true }, "response:object", false]);
    expect(Object.keys(input).sort()).toEqual(["max_tokens", "messages", "reasoning_effort", "response_format", "temperature"]);
    expect([input.reasoning_effort, input.max_tokens, input.response_format]).toEqual(["low", WORKERS_AI_MAX_TOKENS, { type: "json_schema", json_schema: REQ.schema }]);
    const out = workersAi({ run: (async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); }) as never });
    await expect(out.structured(REQ)).rejects.toMatchObject({ status: 429 });
  });

  it("타임아웃(설계서 v0.1.35): Groq 8초, 폴백 OpenRouter 15초 — fetch에 넘기는 신호로 본다, FAKE_GROQ_429 스텁은 부르지 않고 429", async () => {
    expect([TIMEOUT_MS, FALLBACK_TIMEOUT_MS]).toEqual([8_000, 15_000]);
    const seen: string[] = [];
    const orig = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      seen.push(String(ms));
      return orig(ms);
    });
    const ok = (async () => new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{}" } }] }), { status: 200 })) as unknown as typeof fetch;
    await groq({ GROQ_API_KEY: "k" }, ok).structured(REQ);
    await openrouter({ OPENROUTER_API_KEY: "o" }, ok).structured(REQ);
    spy.mockRestore();
    expect(seen).toEqual(["8000", "15000"]);
    await expect(groq429Stub().structured(REQ)).rejects.toMatchObject({ status: 429 });
  });

  it("Workers AI 바인딩은 this가 붙은 채로 부른다(운영 11-11 '#options' 실패 회귀 시험 — 실제 바인딩처럼 private 필드를 쓰는 가짜)", async () => {
    class FakeAi {
      #options: object | undefined;
      aiGatewayLogId: string | null = null;
      async run(_model: string, _input: object, opts?: { gateway?: object }) {
        this.#options = opts ?? {};
        if (opts?.gateway) this.aiGatewayLogId = "log-1";
        return { choices: [{ message: { content: JSON.stringify({ seen: Object.keys(this.#options) }) } }] };
      }
    }
    const direct = await workersAi(new FakeAi() as never).structured(REQ);
    expect([direct.json, direct.shape, direct.viaGateway]).toEqual([{ seen: [] }, "choices", false]);
    const viaGw = await workersAi(new FakeAi() as never, "copilot").structured(REQ);
    expect([viaGw.json, viaGw.viaGateway]).toEqual([{ seen: ["gateway"] }, true]);
  });

  it("schema_hint(설계서 v0.1.35): Workers AI만 system 메시지로 출력 스키마를 앞에 붙인다 — 요청 messages는 그대로 뒤에", async () => {
    let input: { messages?: { role: string; content: string }[] } = {};
    const ai = { run: (async (_m: string, i: typeof input) => ((input = i), { response: { ok: true } })) as never };
    await workersAi(ai, null, { body: loadPrompt("schema_hint", "v1").body, version: "v1" }).structured(REQ);
    expect(input.messages!.map((m) => m.role)).toEqual(["system", "user"]);
    expect(input.messages![0]!.content).toContain(JSON.stringify(REQ.schema));
    expect(input.messages![0]!.content).not.toContain("{{schema}}");
    expect(input.messages![1]).toEqual(REQ.messages[0]);
    await workersAi(ai).structured(REQ);
    expect(input.messages).toEqual(REQ.messages);
    // 게이트웨이 캐시 키에 schema_hint 버전(설계서 v0.1.36 — 버전을 바꾸면 옛 응답을 받지 않는다)
    let opts: { gateway?: { cacheKey?: string } } = {};
    const gwAi = { run: (async (_m: string, _i: object, o: typeof opts) => ((opts = o), { response: { ok: true } })) as never };
    await workersAi(gwAi, "copilot", { body: "{{schema}}", version: "v1" }).structured({ ...REQ, cacheKey: "ans:k:1" });
    expect(opts.gateway?.cacheKey).toBe("ans:k:1:workers-ai:r4:shv1");
  });
});
