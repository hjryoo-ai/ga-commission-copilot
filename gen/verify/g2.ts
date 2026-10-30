// G2 불변식·결정론(설계서 §4.2): projection-java `replay` CLI를 부른다. 종료 코드를 먼저 본다 —
// 0이 아니면(1 위반, 2 입력 오류, 신호 종료) 요약 JSON이 없거나 깨져 있어도 실패다. 0일 때만 요약을 파싱해 다시 대조한다.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";

export const PROJECTION_DIR = join(REPO_ROOT, "projection-java");
export const REPLAY_BIN = join(PROJECTION_DIR, "build/install/projection-java/bin/projection-java");

export interface CliRun {
  /** null이면 신호로 끝났다. */
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ReplaySummary {
  ok: boolean;
  streamSha256: string;
  events: number;
  viewsSha256: string;
  viewsSha256Second: string;
  tables: Record<string, number>;
  violationCount: number;
  violations: string[];
}

export interface G2Result {
  status: "PASS" | "FAIL";
  exitCode: number | null;
  reasons: string[];
  summary: ReplaySummary | null;
}

export type CliRunner = (streamPath: string) => CliRun;

/** projection-java installDist(최신이면 바로 끝남). 실패하면 stderr, 성공하면 null. */
export function buildReplayCli(): string | null {
  const build = spawnSync("./gradlew", ["-q", "--no-daemon", "installDist"], { cwd: PROJECTION_DIR, encoding: "utf8" });
  return build.status === 0 ? null : `projection-java installDist 실패(exit ${build.status}): ${build.stderr}`;
}

/** installDist 뒤 CLI 실행. */
export const runReplayCli: CliRunner = (streamPath) => {
  const buildError = buildReplayCli();
  if (buildError) return { status: 2, stdout: "", stderr: buildError };
  const r = spawnSync(REPLAY_BIN, ["replay", streamPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error) : "") };
};

function parseSummary(stdout: string): ReplaySummary | null {
  const line = stdout.trim().split("\n").at(-1);
  if (!line) return null;
  try {
    const s = JSON.parse(line) as ReplaySummary;
    return typeof s === "object" && s !== null && typeof s.ok === "boolean" ? s : null;
  } catch {
    return null;
  }
}

/** @param expected 우리가 계산한 스트림 해시·이벤트 수 — CLI가 같은 파일을 읽었는지 대조한다 */
export function runG2(streamPath: string, expected: { sha256: string; events: number }, run: CliRunner = runReplayCli): G2Result {
  const r = run(streamPath);
  const summary = parseSummary(r.stdout);
  const reasons: string[] = [];
  if (r.status !== 0) {
    reasons.push(r.status === null ? "CLI가 신호로 종료" : `CLI exit ${r.status}${r.status === 1 ? "(불변식 위반)" : r.status === 2 ? "(사용법·입력 오류)" : ""}`);
    if (summary) reasons.push(...summary.violations.slice(0, 20));
    else if (r.stderr.trim()) reasons.push(r.stderr.trim().split("\n").slice(0, 5).join(" / "));
    return { status: "FAIL", exitCode: r.status, reasons, summary };
  }
  if (!summary) return { status: "FAIL", exitCode: 0, reasons: ["exit 0이지만 요약 JSON이 없거나 깨짐"], summary: null };
  if (!summary.ok || summary.violationCount !== 0) reasons.push(`exit 0인데 ok=${summary.ok}, violationCount=${summary.violationCount}`);
  if (summary.viewsSha256 !== summary.viewsSha256Second) reasons.push("2회 리플레이 뷰 해시 다름");
  if (summary.streamSha256 !== expected.sha256) reasons.push(`CLI가 읽은 스트림 해시 ${summary.streamSha256} ≠ ${expected.sha256}`);
  if (summary.events !== expected.events) reasons.push(`CLI 이벤트 수 ${summary.events} ≠ ${expected.events}`);
  return { status: reasons.length ? "FAIL" : "PASS", exitCode: 0, reasons, summary };
}
