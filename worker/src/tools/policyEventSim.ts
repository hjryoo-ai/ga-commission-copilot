// get_policy_event_sim(policyNo)(설계서 §4.3 — 해약 영향 Q5): 데모 모드 시뮬레이션 스텁(sim_stub) 조회. 새 계산은 하지 않는다.
// 스텁이 없는 계약은 found=false·reason NO_STUB(답변 파이프라인이 NEEDS_ENGINE으로 거부).
import { policyMasked } from "../api/policy";
import { fitList, maskDeep, matchPolicies, type ToolContext, type ToolData } from "./result";

export async function getPolicyEventSim(ctx: ToolContext, policyArg: string): Promise<{ data: ToolData; tokens: number; truncated: boolean }> {
  const [ledgers, lines] = await Promise.all([
    ctx.q.all<{ policy_no: string }>("policy_limit", { columns: ["policy_no"] }),
    ctx.q.all<{ policy_no: string }>("earnings_line", { columns: ["policy_no"], distinct: true }),
  ]);
  const hits = matchPolicies([...ledgers, ...lines].map((x) => x.policy_no), policyArg);
  if (hits.length !== 1) return fitList((xs) => ({ found: false, reason: hits.length > 1 ? "AMBIGUOUS" : "NO_POLICY", candidates: xs }), "candidates", hits.map(policyMasked));
  const stub = await ctx.q.simStub(hits[0]!, "POLICY_EVENT");
  if (!stub) return fitList(() => ({ found: false, reason: "NO_STUB", policyMasked: policyMasked(hits[0]!) }), "candidates", []);
  let response: unknown;
  try {
    response = JSON.parse(stub.response);
  } catch {
    throw new Error("sim_stub.response JSON 아님");
  }
  return fitList(() => ({ found: true, policyMasked: policyMasked(hits[0]!), ruleSnapshotId: stub.rule_snapshot_id, simulation: maskDeep(response) }), "candidates", []);
}
