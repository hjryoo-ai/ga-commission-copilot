// 검증 게이트(설계서 §4.2, PHASES Phase 1 항목 5): G1(스키마) → G2(projection-java 리플레이·불변식) → G3(필수 케이스) 순서.
// 앞 게이트가 실패하면 뒤는 돌리지 않는다. 모두 통과하면 data/stream/<sha256>.jsonl(스트림 바이트 그대로)과 <sha256>.meta.json을 쓴다.
// 결과 보고서는 통과·실패와 관계없이 gen/out/verify.report.json.
//   pnpm run verify            (gen/out/plan.json·stream.jsonl — world:plan·world:expand 출력)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { type Envelope, sha256 } from "../world/expand.ts";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";
import { type CliRunner, type G2Result, runG2, runReplayCli } from "./g2.ts";
import { type CaseResult, type DemoAgent, requiredCases, selectDemoAgents } from "./g3.ts";

export const OUT_DIR = join(import.meta.dirname, "../out");
export const DATA_DIR = join(REPO_ROOT, "data/stream");
/** projection-java/upstream/UPSTREAM의 고정 커밋. */
const PROJECTION_PIN = "ga-agent-portal@126d848";

export type Status = "PASS" | "FAIL" | "SKIPPED";

export interface G1Result {
  status: "PASS" | "FAIL";
  events: number;
  invalid: number;
  examples: string[];
}

export interface Report {
  stream: { path: string; sha256: string; events: number };
  gates: { G1: G1Result; G2: G2Result | { status: "SKIPPED" }; G3: { status: Status; cases: CaseResult[]; demoAgents: DemoAgent[] } };
  ok: boolean;
}

export function parseStream(text: string): Envelope[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Envelope);
}

export function runG1(events: readonly Envelope[]): G1Result {
  const v = validator(SCHEMA_IDS.envelope);
  // Ajv 타입 술어가 실패 분기를 never로 좁히지 않게 boolean으로 감싼다
  const valid = (e: Envelope): boolean => v(e) === true;
  const examples: string[] = [];
  let invalid = 0;
  for (const e of events) {
    if (!valid(e)) {
      invalid++;
      if (examples.length < 5) examples.push(`seq ${e.seq} ${e.type}: ${errorsOf(v)}`);
    }
  }
  return { status: invalid === 0 && events.length > 0 ? "PASS" : "FAIL", events: events.length, invalid, examples };
}

export function verify(streamPath: string, run: CliRunner = runReplayCli): Report {
  const text = readFileSync(streamPath, "utf8");
  const hash = sha256(text);
  const events = parseStream(text);
  const g1 = runG1(events);
  const g2: Report["gates"]["G2"] = g1.status === "PASS" ? runG2(streamPath, { sha256: hash, events: events.length }, run) : { status: "SKIPPED" };
  const cases = g2.status === "PASS" ? requiredCases(events) : [];
  const demoAgents = g2.status === "PASS" ? selectDemoAgents(events) : [];
  const g3Status: Status = g2.status !== "PASS" ? "SKIPPED" : cases.every((c) => c.status === "PASS") ? "PASS" : "FAIL";
  return {
    stream: { path: streamPath, sha256: hash, events: events.length },
    gates: { G1: g1, G2: g2, G3: { status: g3Status, cases, demoAgents } },
    ok: g1.status === "PASS" && g2.status === "PASS" && g3Status === "PASS",
  };
}

interface PlanMeta {
  prompt: string;
  repairPrompt?: string;
  mode: string;
  source: string;
  liveCalls: number;
}

/** data/stream/<sha256>.meta.json — 통과한 스트림의 출처와 게이트 결과. */
export function streamMeta(report: Report, planMeta: PlanMeta, planSha256: string | null, generatedAt: string) {
  const g2 = report.gates.G2 as G2Result;
  return {
    streamSha256: report.stream.sha256,
    generatedAt,
    eventCount: report.stream.events,
    plan: {
      prompt: planMeta.prompt,
      repairPrompt: planMeta.repairPrompt ?? null,
      // vcr = 실호출 녹화 재생, fixture(수기) = 녹화 전 수기 픽스처(LLM 출력 아님), live = 이번 실행의 실호출
      source: planMeta.source,
      mode: planMeta.mode,
      liveCalls: planMeta.liveCalls,
      sha256: planSha256,
    },
    replay: { projection: PROJECTION_PIN, viewsSha256: g2.summary!.viewsSha256, tables: g2.summary!.tables },
    gates: { G1: report.gates.G1.status, G2: g2.status, G3: report.gates.G3.status },
    requiredCases: report.gates.G3.cases.map(({ id, status, detail }) => ({ id, status, detail })),
    // 설계서 v0.1.11 §4.1(a) — load:d1이 demo_agents 표에 그대로 넣는다
    demoAgents: report.gates.G3.demoAgents,
  };
}

function printReport(r: Report): void {
  const g = r.gates;
  console.log(`stream ${r.stream.sha256} (${r.stream.events}건)`);
  console.log(`G1 스키마      ${g.G1.status}  invalid ${g.G1.invalid}/${g.G1.events}${g.G1.examples.length ? `\n  ${g.G1.examples.join("\n  ")}` : ""}`);
  if (g.G2.status === "SKIPPED") console.log("G2 리플레이    SKIPPED");
  else {
    const s = g.G2.summary;
    console.log(`G2 리플레이    ${g.G2.status}  exit ${g.G2.exitCode}${s ? `  views ${s.viewsSha256} (2회차 ${s.viewsSha256 === s.viewsSha256Second ? "동일" : "다름"})` : ""}`);
    for (const x of g.G2.reasons) console.log(`  ${x}`);
  }
  console.log(`G3 필수 케이스 ${g.G3.status}`);
  for (const c of g.G3.cases) console.log(`  ${c.status}  ${c.id.padEnd(22)} ${c.detail}`);
  console.log(r.ok ? "verify: PASS" : "verify: FAIL");
}

function main(): void {
  const streamPath = join(OUT_DIR, "stream.jsonl");
  if (!existsSync(streamPath)) {
    console.error(`${streamPath} 없음 — 먼저 pnpm run world:plan --stub && pnpm run world:expand`);
    process.exit(2);
  }
  const report = verify(streamPath);
  writeFileSync(join(OUT_DIR, "verify.report.json"), `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  if (!report.ok) process.exit(1);

  const planMeta = JSON.parse(readFileSync(join(OUT_DIR, "plan.meta.json"), "utf8")) as PlanMeta;
  const streamMetaIn = JSON.parse(readFileSync(join(OUT_DIR, "stream.meta.json"), "utf8")) as { sha256: string; planSha256?: string };
  if (streamMetaIn.sha256 !== report.stream.sha256) {
    console.error(`stream.meta.json 해시 ${streamMetaIn.sha256} ≠ 스트림 ${report.stream.sha256} — world:expand를 다시 돌린다`);
    process.exit(1);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const base = join(DATA_DIR, report.stream.sha256);
  copyFileSync(streamPath, `${base}.jsonl`);
  // 같은 스트림을 다시 검증하면 처음 생성 시각을 그대로 둔다(D1 stream_meta.generated_at과 어긋나지 않게)
  const prev = existsSync(`${base}.meta.json`) ? (JSON.parse(readFileSync(`${base}.meta.json`, "utf8")) as { generatedAt?: string }).generatedAt : undefined;
  const meta = streamMeta(report, planMeta, streamMetaIn.planSha256 ?? null, prev ?? new Date().toISOString());
  writeFileSync(`${base}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`→ data/stream/${report.stream.sha256}.jsonl + .meta.json`);
}

if (import.meta.main) main();
