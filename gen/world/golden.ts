// A-1 골든 기준(설계서 v0.1.5 §4.1(a)): 데모 설계사 1의 A-1 계약은 상위 샘플 스트림과 payload 필드 단위로 동등하다
// (eventId·occurredAt·전역 seq 오프셋 제외). basisSeq처럼 seq를 가리키는 필드는 대응하는 우리 seq로 바꿔 비교한다.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type { Envelope } from "./expand.ts";
import { CONTRACTS_DIR } from "./schemas.ts";

export const A1_GOLDEN_PATH = join(CONTRACTS_DIR, "events/v1/samples/a1/a1_portal_150000_e2.jsonl");

export function loadA1Golden(): Envelope[] {
  return readFileSync(A1_GOLDEN_PATH, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Envelope);
}

/** 골든 이벤트를 우리 스트림에서 찾는 자연 키(유형별 식별 필드). */
function naturalKey(e: Envelope): string | null {
  const p = e.payload;
  switch (e.type) {
    case "LimitLedgerOpened":
      return `${e.type}|${p.ledgerId}`;
    case "CommissionCalculated":
      return `${e.type}|${p.calcId}`;
    case "LimitLedgerPosted":
      return `${e.type}|${p.ledgerId}|${p.postingSeq}`;
    case "StatementConfirmed":
    case "PayoutCompleted":
      return `${e.type}|${p.agentId}|${p.closeYm}`;
    case "PolicyEventObserved":
      return `${e.type}|${p.policyNo}|${p.eventType}|${p.occurredOn}`;
    case "StatementEstimated":
      return `${e.type}|${p.agentId}|${p.closeYm}|${p.asOf}`;
    default:
      return null;
  }
}

/** 차이 목록(비면 동등). 순서도 골든과 같아야 한다. */
export function a1GoldenProblems(stream: readonly Envelope[], golden = loadA1Golden()): string[] {
  const index = new Map<string, Envelope[]>();
  for (const e of stream) {
    const k = naturalKey(e);
    if (k) index.set(k, [...(index.get(k) ?? []), e]);
  }
  const out: string[] = [];
  const seqMap = new Map<number, number>();
  let prevSeq = 0;
  for (const g of golden) {
    const k = naturalKey(g);
    const found = k ? (index.get(k) ?? []) : [];
    if (found.length !== 1) {
      out.push(`골든 seq ${g.seq} ${g.type}: 우리 스트림에서 ${found.length}건`);
      continue;
    }
    const o = found[0]!;
    seqMap.set(g.seq, o.seq);
    if (o.seq <= prevSeq) out.push(`골든 seq ${g.seq}: 순서 역전(우리 seq ${o.seq})`);
    prevSeq = o.seq;
    const expected = { ...g.payload };
    if (typeof expected.basisSeq === "number") expected.basisSeq = seqMap.get(expected.basisSeq) ?? `골든 seq ${expected.basisSeq} 대응 없음`;
    if (o.type !== g.type || o.version !== g.version) out.push(`골든 seq ${g.seq}: 유형·버전 다름`);
    if (!isDeepStrictEqual(o.aggregate, g.aggregate)) out.push(`골든 seq ${g.seq}: aggregate ${JSON.stringify(o.aggregate)} ≠ ${JSON.stringify(g.aggregate)}`);
    if (!isDeepStrictEqual(o.payload, expected)) out.push(`골든 seq ${g.seq}: payload\n  우리 ${JSON.stringify(o.payload)}\n  골든 ${JSON.stringify(expected)}`);
  }
  return out;
}
