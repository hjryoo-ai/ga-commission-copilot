// 설명 레코드 저장소(설계서 v0.1.14 §4.1(b)): <dir>/<streamHash>/<kind>.jsonl. 캐시 키 = streamHash + promptVersion + kind + subjectId.
// 기본 dir은 data/explain(커밋). --stub 산출은 gen/out/explain(커밋 안 함).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../providers/prompt.ts";
import { errorsOf, SCHEMA_IDS, validator } from "../world/schemas.ts";
import type { Kind } from "./context.ts";

export const DATA_EXPLAIN = join(REPO_ROOT, "data/explain");
export const OUT_EXPLAIN = join(import.meta.dirname, "../out/explain");
export const KINDS: readonly Kind[] = ["LINE", "LIMIT", "MONTH_DIFF"];

export interface ExplanationRecord {
  tenantId: string;
  agentId: string;
  kind: Kind;
  subjectId: string;
  streamHash: string;
  promptVersion: string;
  provider: "groq" | "workers-ai" | "vcr";
  model: string;
  text: string;
  citedFields: string[];
  numbersUsed: string[];
  groundingStatus: "PASS" | "FAIL";
  attempts: 1 | 2;
  failure?: { g4: string[]; g5: string[]; g6: string[] };
  createdAt: string;
}

const fileOf = (dir: string, hash: string, kind: Kind) => join(dir, hash, `${kind.toLowerCase()}.jsonl`);
export const cacheKey = (r: Pick<ExplanationRecord, "promptVersion" | "kind" | "agentId" | "subjectId">) => `${r.promptVersion}\u001f${r.kind}\u001f${r.agentId}\u001f${r.subjectId}`;

/** G1(contracts/explain/v1/explanation.schema.json) 위반 목록. */
export function recordProblems(r: unknown): string[] {
  const v = validator(SCHEMA_IDS.explanation);
  return v(r) ? [] : [errorsOf(v)];
}

export class ExplanationStore {
  readonly dir: string;
  readonly hash: string;
  private readonly rows = new Map<Kind, Map<string, ExplanationRecord>>();

  constructor(dir: string, hash: string) {
    this.dir = dir;
    this.hash = hash;
    for (const k of KINDS) {
      const m = new Map<string, ExplanationRecord>();
      const f = fileOf(dir, hash, k);
      if (existsSync(f)) {
        for (const line of readFileSync(f, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const r = JSON.parse(line) as ExplanationRecord;
          const problems = recordProblems(r);
          if (problems.length) throw new Error(`${f}: G1 ${problems.join("; ")}`);
          if (r.streamHash !== hash || r.kind !== k) throw new Error(`${f}: 다른 스트림·종류 행 ${r.streamHash.slice(0, 12)} ${r.kind}`);
          m.set(cacheKey(r), r);
        }
      }
      this.rows.set(k, m);
    }
  }

  has(key: Pick<ExplanationRecord, "promptVersion" | "kind" | "agentId" | "subjectId">): boolean {
    return this.rows.get(key.kind)!.has(cacheKey(key));
  }

  get(key: Pick<ExplanationRecord, "promptVersion" | "kind" | "agentId" | "subjectId">): ExplanationRecord | undefined {
    return this.rows.get(key.kind)!.get(cacheKey(key));
  }

  all(): ExplanationRecord[] {
    return KINDS.flatMap((k) => [...this.rows.get(k)!.values()]);
  }

  /** 넣고 그 종류 파일을 다시 쓴다(정렬: 설계사·subject — 결정론, 중단돼도 쓴 데까지 남는다). */
  put(r: ExplanationRecord): void {
    const problems = recordProblems(r);
    if (problems.length) throw new Error(`explanation G1: ${problems.join("; ")}`);
    const m = this.rows.get(r.kind)!;
    m.set(cacheKey(r), r);
    const sorted = [...m.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || a.subjectId.localeCompare(b.subjectId) || a.promptVersion.localeCompare(b.promptVersion));
    mkdirSync(join(this.dir, this.hash), { recursive: true });
    writeFileSync(fileOf(this.dir, this.hash, r.kind), sorted.map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
}
