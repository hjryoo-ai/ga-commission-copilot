import { describe, expect, it } from "vitest";
import {
  fallbackChain,
  groq,
  openrouter,
  type Provider,
  ProviderError,
  type ProviderName,
  ProvidersExhausted,
  type StructuredRequest,
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

  it("Workers AI: 응답 모양 둘 다(choices·response), 뉴런 소진(4006)은 429로, 바인딩 입력은 messages + json_schema", async () => {
    expect(workersAiContent({ choices: [{ message: { content: '{"a":1}' } }] }).json).toEqual({ a: 1 });
    expect(workersAiContent({ response: '{"a":2}' }).json).toEqual({ a: 2 });
    expect(workersAiContent({ response: { a: 3 } }).json).toEqual({ a: 3 });
    expect(() => workersAiContent({ foo: 1 })).toThrow(ProviderError);
    let input: Record<string, unknown> = {};
    const r = await workersAi({
      run: (async (model: string, i: Record<string, unknown>) => {
        expect(model).toBe(WORKERS_AI_MODEL);
        input = i;
        return { response: { ok: true } };
      }) as never,
    }).structured(REQ);
    expect([r.provider, r.model, r.json]).toEqual(["workers-ai", WORKERS_AI_MODEL, { ok: true }]);
    expect(Object.keys(input).sort()).toEqual(["max_tokens", "messages", "response_format", "temperature"]);
    const out = workersAi({ run: (async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); }) as never });
    await expect(out.structured(REQ)).rejects.toMatchObject({ status: 429 });
  });
});
