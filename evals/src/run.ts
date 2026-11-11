// 평가 하네스(설계서 §13·v0.1.37·v0.1.38, PHASES Phase 6 항목 2). /ask를 부르지 않고 worker의 answerQuestion을 그대로 쓴다(런타임 동일).
//   node out/run.mjs --live [--set all|pr|appendix] [--groq-calls 50] [--wai-calls 60] [--trigger manual|weekly|pr:<n>|variance:<날>]
//   node out/run.mjs --stub [--set …]   — evals/vcr/eval.json 재생(LLM·임베딩·원격 0)
// 바인딩: wrangler getPlatformProxy(worker/wrangler.jsonc env.record) — D1 로컬, AI·Vectorize 원격(--live). 비밀은 worker/.dev.vars.record.
// 실호출 규칙(운영자): 모든 LLM 요청에 cf-aig-skip-cache(v0.1.38), 답 단위 재사용 없음(answerQuestion만 부른다), 공급자는 케이스마다 하나로 고정
// (Groq 상한 → 넘으면 Workers AI — v0.1.37 주간 방식, 한 케이스 안에서 공급자를 섞지 않는다). Groq는 TPM 8K라 호출 사이 간격·429 대기.
// 결과: evals/out/<runId>/{runs.jsonl,summary.json,load.sql} + 로컬 D1 eval_run·eval_case_result. 원격 적재는 load.sql을 사람이 확인한 뒤.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activeStream, DEMO_TENANT, rulebookChunks, ScopedQuery } from "../../worker/src/db/ScopedQuery";
import { type AnswerDeps, type AnswerResult, answerQuestion, cloudflareDeps } from "../../worker/src/llm/answer";
import { activePrompt } from "../../worker/src/llm/promptRegistry";
import { groq, type Provider, ProviderError, type ProviderName, requestHash, type StructuredRequest, type StructuredResponse, traced, workersAi } from "../../worker/src/llm/providers";
import { type CaseRun, type EvalCase, scoreCase, summarize } from "./score";

const ROOT = join(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const live = args.includes("--live");
const stub = args.includes("--stub");
if (live === stub) throw new Error("--live 또는 --stub 하나");
const set = arg("--set") ?? "all";
const caps: Record<"groq" | "workers-ai", number> = { groq: Number(arg("--groq-calls") ?? 50), "workers-ai": Number(arg("--wai-calls") ?? 60) };
const trigger = arg("--trigger") ?? "manual";
const GROQ_GAP_MS = Number(arg("--groq-gap-ms") ?? 30_000); // TPM 8K ÷ 호출당 약 3.5K → 분당 2회 남짓
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const allCases = readFileSync(join(ROOT, "evals/cases.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as EvalCase);
const sample = JSON.parse(readFileSync(join(ROOT, "evals/pr-sample.json"), "utf8")) as { fixed: string[]; stratified: Record<string, string[]> };
const pick = set === "all" ? allCases.map((c) => c.id) : set === "appendix" ? sample.fixed : set === "pr" ? [...sample.fixed, ...Object.values(sample.stratified).flat()] : set.split(",");
const cases = allCases.filter((c) => pick.includes(c.id));

/** 공급자 호출 수를 세고, Groq는 간격을 두며 429면 기다렸다 다시(평가는 공급자를 바꾸지 않는다). 모든 요청에 skipCache. */
function evalProvider(p: Provider, used: Record<string, number>): Provider {
  let last = 0;
  return {
    name: p.name,
    async structured(req: StructuredRequest): Promise<StructuredResponse> {
      for (let attempt = 0; ; attempt++) {
        if (p.name === "groq") {
          const wait = last + GROQ_GAP_MS - Date.now();
          if (wait > 0) await sleep(wait);
          last = Date.now();
        }
        used[p.name] = (used[p.name] ?? 0) + 1;
        try {
          return { ...(await p.structured({ ...req, skipCache: true })), fallbackDepth: p.name === "groq" ? 0 : 1 };
        } catch (e) {
          if (e instanceof ProviderError && e.status === 429 && p.name === "groq" && attempt < 4) {
            const s = e.retryAfterS ?? 60;
            console.warn(`[eval] groq 429 — ${s}s 기다림`);
            await sleep(s * 1000);
            continue;
          }
          throw e;
        }
      }
    },
  };
}

interface Cassette {
  entries: Record<string, { request: unknown; response: { json: unknown; model: string; usage: unknown }; provider: string }>;
}

function stubDeps(env: Env, cassette: Cassette, question: string): AnswerDeps {
  const search: string[] = [];
  for (const e of Object.values(cassette.entries)) {
    const c = (e.request as { messages: { role: string; content: string }[] }).messages.at(-1)!.content;
    if (c.includes("단계: 1단계") && c.includes(`<question>\n${question}\n</question>`)) search.push(...[...c.matchAll(/\[chunkId ([^\]]+)\]/g)].map((m) => m[1]!));
  }
  const provider: Provider = {
    name: "groq",
    async structured(req) {
      const e = cassette.entries[await requestHash(req)];
      if (!e) throw new ProviderError("녹화 없음(stub)", 0);
      return { json: e.response.json, provider: e.provider as ProviderName, model: e.response.model, usage: null };
    },
  };
  return {
    provider,
    embed: async () => Array.from({ length: 1024 }, () => 0),
    search: async (_v, topK) => search.slice(0, topK).map((id, i) => ({ id, score: 0.9 - i / 100 })),
    chunks: (ids) => rulebookChunks(env.DB, ids),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
}

async function main() {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, "worker/wrangler.jsonc"), environment: "record", envFiles: [".dev.vars.record"], persist: { path: join(ROOT, "worker/.wrangler/state/v3") }, remoteBindings: live });
  const env = proxy.env;
  try {
    const stream = await activeStream(env.DB);
    if (!stream) throw new Error("활성 스트림 없음(로컬 D1 — load:d1 --local)");
    const runId = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${trigger.replace(/[^a-z0-9]+/gi, "-")}`;
    const out = join(ROOT, "evals/out", runId);
    mkdirSync(out, { recursive: true });
    const cassette = stub ? (JSON.parse(readFileSync(arg("--cassette") ?? join(ROOT, "evals/vcr/eval.json"), "utf8")) as Cassette) : null;
    const used: Record<string, number> = {};
    const hint = activePrompt(env, "schema_hint");
    const gwId = env.AI_GATEWAY_ID || null;
    const gw = gwId ? () => env.AI.gateway(gwId) : null;
    const base: Record<"groq" | "workers-ai", Provider> = {
      groq: evalProvider(traced(groq(env, fetch, undefined, gw), env, env.DB), used),
      "workers-ai": evalProvider(traced(workersAi(env.AI, gwId, { body: hint.body, version: hint.version }), env, env.DB), used),
    };
    const runs: { run: CaseRun; score: ReturnType<typeof scoreCase>; c: EvalCase }[] = [];
    console.log(`[eval] ${runId} — ${cases.length}건(${set}), ${live ? `live Groq ${caps.groq}·Workers AI ${caps["workers-ai"]} 호출` : "stub"}, stream ${stream.streamHash.slice(0, 12)}, PROMPT_VERSIONS ${env.PROMPT_VERSIONS}`);
    for (const c of cases) {
      for (const mode of c.modes) {
        const q = new ScopedQuery(env.DB, { tenantId: DEMO_TENANT, agentId: c.agentId, stream });
        let run: CaseRun = { caseId: c.id, mode };
        // 케이스당 공급자 하나 — 남은 상한이 2호출(툴 계획 + 답) 이상인 쪽, Groq 먼저
        const name = live ? ((["groq", "workers-ai"] as const).find((n) => (used[n] ?? 0) + 2 <= caps[n]) ?? null) : "groq";
        if (!name) run = { ...run, error: "예산(eval 상한) — 미실행" };
        else {
          const deps = stub ? stubDeps(env, cassette!, c.question) : cloudflareDeps(env, base[name]);
          if (mode === "rulesUnavailable") deps.embed = () => Promise.reject(new Error("rulesUnavailable(eval 모드)"));
          const t0 = Date.now();
          try {
            const r: AnswerResult = await answerQuestion(deps, q, env, c.question);
            run = { ...run, provider: r.provider, model: r.model, refused: r.refused, reason: r.reason, groundingStatus: r.groundingStatus, text: r.text, toolCalls: r.toolCalls.map((t) => ({ tool: t.tool, args: t.args as Record<string, string> })), rulesUnavailable: r.rulesUnavailable, latencyMs: Date.now() - t0 };
          } catch (e) {
            run = { ...run, provider: name, error: `${(e as Error).name}: ${(e as Error).message.slice(0, 200)}`, latencyMs: Date.now() - t0 };
          }
        }
        const score = scoreCase(c, run);
        runs.push({ run, score, c });
        console.log(`[eval] ${c.id}${mode === "normal" ? "" : ` (${mode})`} ${run.provider ?? "-"} ${score.passed ? "PASS" : `✗ ${score.failureKind}`}${run.error ? ` ${run.error}` : ""} ${run.latencyMs ?? 0}ms — 호출 ${JSON.stringify(used)}`);
      }
    }
    const normal = runs.filter((x) => x.run.mode === "normal");
    const byProvider = Object.fromEntries([...new Set(normal.map((x) => x.run.provider ?? "none"))].map((p) => [p, summarize(normal.filter((x) => (x.run.provider ?? "none") === p))]));
    const summary = { runId, trigger, set, live, startedAt: new Date().toISOString(), promptVersions: env.PROMPT_VERSIONS, streamHash: stream.streamHash, calls: used, all: summarize(normal), byProvider, rulesUnavailable: summarize(runs.filter((x) => x.run.mode === "rulesUnavailable")) };
    writeFileSync(join(out, "runs.jsonl"), runs.map((x) => JSON.stringify({ ...x.run, score: x.score })).join("\n") + "\n");
    writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    // eval_run·eval_case_result(설계서 §5.1) — 로컬 D1 + 원격용 SQL
    const pv = JSON.stringify(Object.fromEntries((env.PROMPT_VERSIONS ?? "").split(",").filter(Boolean).map((p) => p.split("="))));
    const model = Object.keys(byProvider).sort().join("+");
    const s = summary.all;
    const rate = (a: { rate: number | null }) => (a.rate === null ? null : a.rate / 100);
    const stmts: { sql: string; binds: unknown[] }[] = [
      { sql: "INSERT INTO eval_run (run_id, started_at, trigger, prompt_versions, stream_hash, model, total, passed, grounding_pass_rate, refusal_accuracy, tool_accuracy, mean_latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", binds: [runId, summary.startedAt, trigger, pv, stream.streamHash, model, s.total, s.passed, rate(s.grounding), rate(s.refusal), rate(s.tool), s.meanLatencyMs] },
      ...runs.map((x) => ({
        sql: "INSERT INTO eval_case_result (run_id, case_id, passed, expected, actual, failure_kind) VALUES (?,?,?,?,?,?)",
        binds: [runId, x.run.mode === "normal" ? x.c.id : `${x.c.id}#${x.run.mode}`, x.score.passed ? 1 : 0, JSON.stringify({ bucket: x.c.bucket, expectedTools: x.c.expectedTools, facts: x.c.expectedFacts.slice(0, x.c.coreFacts ?? 3).map((f) => f.fact), expectRefusal: x.c.expectRefusal, expectReason: x.c.expectReason, misleading: x.c.misleading, tags: x.c.tags }), JSON.stringify({ ...x.run, score: x.score }), x.score.failureKind],
      })),
    ];
    await env.DB.batch(stmts.map((x) => env.DB.prepare(x.sql).bind(...x.binds)));
    const lit = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
    writeFileSync(join(out, "load.sql"), stmts.map((x) => { let i = 0; return `${x.sql.replace(/\?/g, () => lit(x.binds[i++]))};`; }).join("\n") + "\n");
    console.log(`[eval] 요약 ${JSON.stringify(summary.all)}`);
    for (const [p, v] of Object.entries(byProvider)) console.log(`[eval]   ${p}: ${JSON.stringify(v)}`);
    console.log(`[eval] → ${out}`);
  } finally {
    await proxy.dispose();
  }
}

await main();
