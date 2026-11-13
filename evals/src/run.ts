// 평가 하네스(설계서 §13·v0.1.37·v0.1.38, PHASES Phase 6 항목 2). /ask를 부르지 않고 worker의 answerQuestion을 그대로 쓴다(런타임 동일).
//   node out/run.mjs --live [--set all|pr|appendix] [--groq-calls 50] [--wai-calls 60] [--trigger manual|weekly|pr:<n>|variance:<날>]
//   node out/run.mjs --stub [--set …]   — evals/vcr/eval.json 재생(LLM·임베딩·원격 0)
// 바인딩: wrangler getPlatformProxy(worker/wrangler.jsonc env.record) — D1 로컬, AI·Vectorize 원격(--live). 비밀은 worker/.dev.vars.record.
// 실호출 규칙(운영자): 모든 LLM 요청에 cf-aig-skip-cache(v0.1.38), 답 단위 재사용 없음(answerQuestion만 부른다), 공급자는 케이스마다 하나로 고정
// (Groq 상한 → 넘으면 Workers AI — v0.1.37 주간 방식, 한 케이스 안에서 공급자를 섞지 않는다). Groq는 TPM 8K라 호출 사이 간격·429 대기.
// 결과: evals/out/<runId>/{runs.jsonl,summary.json,load.sql} + 로컬 D1 eval_run·eval_case_result. 원격 적재는 load.sql을 사람이 확인한 뒤.
//   node out/run.mjs --rescore evals/out/<runId> [--as r1] [--reverify]  — --reverify면 카세트의 같은 모델 출력을 지금 검증기로 다시 통과(LLM 0). 채점기·골든을 고친 뒤 같은 답을 다시 매긴다. --as면 새 run(<runId>-r1, trigger rescore:<원본>), 없으면 제자리.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { activeStream, DEMO_TENANT, rulebookChunks, ScopedQuery } from "../../worker/src/db/ScopedQuery";
import { type AnswerDeps, type AnswerResult, answerQuestion, cloudflareDeps } from "../../worker/src/llm/answer";
import { activePrompt } from "../../worker/src/llm/promptRegistry";
import { groq, type Provider, ProviderError, type ProviderName, requestHash, type StructuredRequest, type StructuredResponse, traced, workersAi } from "../../worker/src/llm/providers";
import { assignProviders, weekParity } from "./assign";
import { type CaseRun, type EvalCase, scoreCase, summarize } from "./score";

const ROOT = join(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const arg = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const live = args.includes("--live");
const stub = args.includes("--stub");
const rescore = arg("--rescore"); // evals/out/<runId> — 녹화된 runs.jsonl을 지금 채점기로 다시 매긴다(LLM·원격 0)
if (!rescore && live === stub) throw new Error("--live 또는 --stub 하나(또는 --rescore <dir>)");
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
            // §14.1-2(Groq TPD 창이 자정 리셋인지 이동 창인지) 실측 — 시각·헤더·본문을 남긴다
            console.warn(`[eval] ${new Date().toISOString()} groq 429 — ${s}s 기다림 · ${JSON.stringify(e.rateLimit)}`);
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

type Scored = { run: CaseRun; score: ReturnType<typeof scoreCase>; c: EvalCase };

interface RunMeta {
  runId: string;
  trigger: string;
  set: string;
  live: boolean;
  startedAt: string;
  finishedAt: string;
  promptVersions: string;
  streamHash: string;
  calls: Record<string, number>;
  /** 공급자 배정 offset(assign.ts) — 기준선 런(2026-11-13)은 배정 도입 전이라 없다(순서대로 Groq 먼저). */
  assignOffset?: number;
  rescoredAt?: string;
  /** --rescore --as로 만든 런의 원본 run_id. */
  rescoredFrom?: string;
  /** --reverify — 녹화한 모델 출력을 지금 검증기로 다시 판정했다. */
  reverified?: boolean;
}

/** summary.json·runs.jsonl·load.sql + 로컬 D1(같은 run_id 행은 지우고 다시). 4축 기준선은 normal 모드만, rulesUnavailable은 따로. */
async function writeOutputs(env: Env, out: string, meta: RunMeta, runs: Scored[]) {
  const normal = runs.filter((x) => x.run.mode === "normal");
  const byProvider = Object.fromEntries([...new Set(normal.map((x) => x.run.provider ?? "none"))].sort().map((p) => [p, summarize(normal.filter((x) => (x.run.provider ?? "none") === p))]));
  const ru = runs.filter((x) => x.run.mode === "rulesUnavailable");
  const summary = { ...meta, all: summarize(normal), byProvider, rulesUnavailable: { ...summarize(ru), byProvider: Object.fromEntries([...new Set(ru.map((x) => x.run.provider ?? "none"))].sort().map((p) => [p, summarize(ru.filter((x) => (x.run.provider ?? "none") === p))])) } };
  writeFileSync(join(out, "runs.jsonl"), runs.map((x) => JSON.stringify({ ...x.run, score: x.score })).join("\n") + "\n");
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  // eval_run·eval_case_result(설계서 §5.1) — eval_run의 율·합계는 normal 60건만. rulesUnavailable 행은 case_id 접미 "#rulesUnavailable"
  const pv = JSON.stringify(Object.fromEntries(meta.promptVersions.split(",").filter(Boolean).map((p) => p.split("="))));
  const model = Object.keys(byProvider).sort().join("+");
  const s = summary.all;
  const rate = (a: { rate: number | null }) => (a.rate === null ? null : Math.round(a.rate * 100) / 10000);
  const stmts: { sql: string; binds: unknown[] }[] = [
    { sql: "INSERT INTO eval_run (run_id, started_at, trigger, prompt_versions, stream_hash, model, total, passed, grounding_pass_rate, refusal_accuracy, tool_accuracy, mean_latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", binds: [meta.runId, meta.startedAt, meta.trigger, pv, meta.streamHash, model, s.total, s.passed, rate(s.grounding), rate(s.refusal), rate(s.tool), s.meanLatencyMs] },
    ...runs.map((x) => ({
      sql: "INSERT INTO eval_case_result (run_id, case_id, passed, expected, actual, failure_kind) VALUES (?,?,?,?,?,?)",
      binds: [meta.runId, x.run.mode === "normal" ? x.c.id : `${x.c.id}#${x.run.mode}`, x.score.passed ? 1 : 0, JSON.stringify({ bucket: x.c.bucket, expectedTools: x.c.expectedTools, facts: x.c.expectedFacts.slice(0, x.c.coreFacts ?? 3).map((f) => f.fact), expectRefusal: x.c.expectRefusal, expectReason: x.c.expectReason, misleading: x.c.misleading, tags: x.c.tags }), JSON.stringify({ ...x.run, score: x.score }), x.score.failureKind],
    })),
  ];
  await env.DB.batch([env.DB.prepare("DELETE FROM eval_case_result WHERE run_id = ?").bind(meta.runId), env.DB.prepare("DELETE FROM eval_run WHERE run_id = ?").bind(meta.runId), ...stmts.map((x) => env.DB.prepare(x.sql).bind(...x.binds))]);
  const lit = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  writeFileSync(join(out, "load.sql"), stmts.map((x) => { let i = 0; return `${x.sql.replace(/\?/g, () => lit(x.binds[i++]))};`; }).join("\n") + "\n");
  console.log(`[eval] 요약(normal ${s.total}건) ${JSON.stringify(summary.all)}`);
  for (const [p, v] of Object.entries(byProvider)) console.log(`[eval]   ${p}: ${JSON.stringify(v)}`);
  console.log(`[eval] rulesUnavailable(별도 ${summary.rulesUnavailable.total}건) ${JSON.stringify({ ...summary.rulesUnavailable, byProvider: undefined })}`);
  console.log(`[eval] → ${out}`);
}

async function main() {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, "worker/wrangler.jsonc"), environment: "record", envFiles: [".dev.vars.record"], persist: { path: join(ROOT, "worker/.wrangler/state/v3") }, remoteBindings: live });
  const env = proxy.env;
  try {
    if (rescore) {
      const src = resolve(rescore);
      const prev = JSON.parse(readFileSync(join(src, "summary.json"), "utf8")) as RunMeta;
      // --as <접미>: 원본 런(파일·원격 행)은 그대로 두고 새 run으로(운영자 2026-11-14 PR-A) — run_id = 원본-접미, trigger = rescore:<원본>
      const as = arg("--as");
      if (as !== undefined && !/^[a-z0-9]+$/.test(as)) throw new Error("--as 접미는 영소문자·숫자");
      const out = as ? `${src}-${as}` : src;
      if (as) mkdirSync(out, { recursive: true });
      const byId = new Map(allCases.map((c) => [c.id, c]));
      // --reverify: 녹화(카세트)의 같은 모델 출력을 지금 worker 코드(검증기 포함)로 다시 통과시킨다 — LLM 0. 답 판정 칸만 바꾸고
      // 공급자·모델·응답 시간·시각은 원본 그대로(재생 시간은 실제 응답 시간이 아니다)
      const reverify = args.includes("--reverify");
      const cassette = reverify ? (JSON.parse(readFileSync(arg("--cassette") ?? join(ROOT, "evals/vcr/eval.json"), "utf8")) as Cassette) : null;
      const stream = reverify ? await activeStream(env.DB) : null;
      if (reverify && (!stream || stream.streamHash !== prev.streamHash)) throw new Error("--reverify: 로컬 활성 스트림이 원본 런과 다르다");
      const runs: Scored[] = [];
      for (const l of readFileSync(join(src, "runs.jsonl"), "utf8").split("\n").filter(Boolean)) {
        const { score: _old, ...orig } = JSON.parse(l) as CaseRun & { score: unknown };
        const c = byId.get(orig.caseId);
        if (!c) throw new Error(`케이스 없음: ${orig.caseId}`);
        let run: CaseRun = orig;
        if (reverify && !orig.error) {
          const deps = stubDeps(env, cassette!, c.question);
          if (orig.mode === "rulesUnavailable") deps.embed = () => Promise.reject(new Error("rulesUnavailable(eval 모드)"));
          const r = await answerQuestion(deps, new ScopedQuery(env.DB, { tenantId: DEMO_TENANT, agentId: c.agentId, stream: stream! }), env, c.question);
          run = { ...orig, refused: r.refused, reason: r.reason, groundingStatus: r.groundingStatus, text: r.text, toolCalls: r.toolCalls.map((t) => ({ tool: t.tool, args: t.args as Record<string, string> })), citedArticles: r.citations.filter((x) => x.kind === "rule").map((x) => x.article), violations: r.grounding, rulesUnavailable: r.rulesUnavailable };
          if (run.groundingStatus !== orig.groundingStatus) console.log(`[eval] 재검증 ${c.id}${orig.mode === "normal" ? "" : ` (${orig.mode})`}: ${orig.groundingStatus} → ${run.groundingStatus} ${JSON.stringify(r.grounding)}`);
        }
        runs.push({ run, score: scoreCase(c, run), c });
      }
      const meta: RunMeta = { runId: as ? `${prev.runId}-${as}` : prev.runId, trigger: as ? `rescore:${prev.trigger}` : prev.trigger, ...(as ? { rescoredFrom: prev.runId } : {}), set: prev.set, live: prev.live, startedAt: prev.startedAt, finishedAt: prev.finishedAt ?? prev.startedAt, promptVersions: prev.promptVersions, streamHash: prev.streamHash, calls: prev.calls, ...(reverify ? { reverified: true } : {}), ...(prev.assignOffset === undefined ? {} : { assignOffset: prev.assignOffset }), rescoredAt: new Date().toISOString() };
      await writeOutputs(env, out, meta, runs);
      return;
    }
    const stream = await activeStream(env.DB);
    if (!stream) throw new Error("활성 스트림 없음(로컬 D1 — load:d1 --local)");
    const startedAt = new Date().toISOString();
    const runId = `${startedAt.replace(/[-:]/g, "").slice(0, 15)}-${trigger.replace(/[^a-z0-9]+/gi, "-")}`;
    const out = join(ROOT, "evals/out", runId);
    mkdirSync(out, { recursive: true });
    const cassette = stub ? (JSON.parse(readFileSync(arg("--cassette") ?? join(ROOT, "evals/vcr/eval.json"), "utf8")) as Cassette) : null;
    const used: Record<string, number> = {};
    const hint = activePrompt(env, "schema_hint");
    const gwId = env.AI_GATEWAY_ID || null;
    const base: Record<"groq" | "workers-ai", Provider> = {
      // Groq는 직접 호출: getPlatformProxy의 AI 바인딩으로 gateway().run에 AbortSignal을 넘기면 "Cannot stringify arbitrary non-POJOs"로
      // 요청 전에 실패해 어차피 직접 1회로 간다(2026-11-13 기준선 런). 직접 호출은 게이트웨이 캐시를 거치지 않는다(skip-cache와 같은 효과).
      groq: evalProvider(traced(groq(env, fetch, undefined, null), env, env.DB), used),
      "workers-ai": evalProvider(traced(workersAi(env.AI, gwId, { body: hint.body, version: hint.version }), env, env.DB), used),
    };
    const runs: Scored[] = [];
    console.log(`[eval] ${runId} — ${cases.length}건(${set}), ${live ? `live Groq ${caps.groq}·Workers AI ${caps["workers-ai"]} 호출` : "stub"}, stream ${stream.streamHash.slice(0, 12)}, PROMPT_VERSIONS ${env.PROMPT_VERSIONS}`);
    // 기준선(normal)을 먼저 다 돌리고 rulesUnavailable 모드를 뒤에 — 상한이 모자라면 별도 집계 쪽이 빠지게(운영자 11-13)
    const order = (["normal", "rulesUnavailable"] as const).flatMap((mode) => cases.filter((c) => c.modes.includes(mode)).map((c) => ({ c, mode })));
    // 공급자 배정(운영자 2026-11-14): 유형마다 상한 비율대로 번갈아 — 앞 N건 몰아주기면 모델 비교가 문항 유형과 섞인다. offset = ISO 주 홀짝
    const assignOffset = Number(arg("--assign-offset") ?? weekParity(new Date(startedAt)));
    const assigned = assignProviders(order, caps, assignOffset);
    for (const [i, { c, mode }] of order.entries()) {
      const q = new ScopedQuery(env.DB, { tenantId: DEMO_TENANT, agentId: c.agentId, stream });
      let run: CaseRun = { caseId: c.id, mode };
      // 케이스당 공급자 하나 — 배정된 쪽에 2호출(툴 계획 + 답) 여유가 없으면 다른 쪽(reassigned), 둘 다 없으면 미실행
      const want = assigned[i]!;
      const other = want === "groq" ? "workers-ai" : "groq";
      const name = live ? ([want, other] as const).find((n) => (used[n] ?? 0) + 2 <= caps[n]) ?? null : "groq";
      if (live && name && name !== want) run = { ...run, reassigned: true };
      if (!name) run = { ...run, error: "예산(eval 상한) — 미실행" };
      else {
        const deps = stub ? stubDeps(env, cassette!, c.question) : cloudflareDeps(env, base[name]);
        if (mode === "rulesUnavailable") deps.embed = () => Promise.reject(new Error("rulesUnavailable(eval 모드)"));
        const t0 = Date.now();
        try {
          const r: AnswerResult = await answerQuestion(deps, q, env, c.question);
          run = { ...run, answerId: r.answerId, at: new Date().toISOString(), provider: r.provider, model: r.model, refused: r.refused, reason: r.reason, groundingStatus: r.groundingStatus, text: r.text, toolCalls: r.toolCalls.map((t) => ({ tool: t.tool, args: t.args as Record<string, string> })), citedArticles: r.citations.filter((x) => x.kind === "rule").map((x) => x.article), violations: r.grounding, rulesUnavailable: r.rulesUnavailable, latencyMs: Date.now() - t0 };
        } catch (e) {
          run = { ...run, at: new Date().toISOString(), provider: name, error: `${(e as Error).name}: ${(e as Error).message.slice(0, 200)}`, latencyMs: Date.now() - t0 };
        }
      }
      const score = scoreCase(c, run);
      runs.push({ run, score, c });
      console.log(`[eval] ${new Date().toISOString()} ${c.id}${mode === "normal" ? "" : ` (${mode})`} ${run.provider ?? "-"} ${score.passed ? "PASS" : `✗ ${score.failureKind}`}${run.error ? ` ${run.error}` : ""} ${run.latencyMs ?? 0}ms — 호출 ${JSON.stringify(used)}`);
    }
    await writeOutputs(env, out, { runId, trigger, set, live, startedAt, finishedAt: new Date().toISOString(), promptVersions: env.PROMPT_VERSIONS ?? "", streamHash: stream.streamHash, calls: used, assignOffset }, runs);
  } finally {
    await proxy.dispose();
  }
}

await main();
