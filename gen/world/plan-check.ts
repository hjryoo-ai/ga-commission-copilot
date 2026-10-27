// 플랜 의미 검사(G1 스키마 다음). JSON Schema로 표현하기 어려운 규칙: 날짜 범위·상품별 월납 범위·계약 이벤트 순서·설계사별 제약.
import { AGENT_CONSTRAINTS, agent } from "./agents.ts";
import { isValidDate, monthsBetween, ymOf } from "./calendar.ts";
import type { LifecycleEvent, PlanContract } from "./plan-types.ts";
import { CONTRACT_FROM, CONTRACT_TO, HORIZON_YM, PRODUCTS } from "./rules/tables.ts";

export function lifecycleProblems(c: Pick<PlanContract, "contractDate" | "lifecycle">): string[] {
  const out: string[] = [];
  const start = ymOf(c.contractDate);
  let state: "INFORCE" | "LAPSED" | "ENDED" = "INFORCE";
  let reduced = false;
  let prev = "";
  for (const e of c.lifecycle as LifecycleEvent[]) {
    if (e.ym < start) out.push(`${e.event} ${e.ym}: 체결월 ${start} 이전`);
    if (e.ym > HORIZON_YM) out.push(`${e.event} ${e.ym}: 범위 ${HORIZON_YM} 이후`);
    if (e.ym < prev) out.push(`${e.event} ${e.ym}: 월 순서 역전`);
    if (e.ym === prev) out.push(`${e.event} ${e.ym}: 같은 달 두 번째 이벤트`);
    prev = e.ym;
    if (state === "ENDED") out.push(`${e.event} ${e.ym}: 해약·철회 뒤 이벤트`);
    switch (e.event) {
      case "CANCEL":
        state = "ENDED";
        break;
      case "WITHDRAW":
        if (monthsBetween(start, e.ym) > 1) out.push(`WITHDRAW ${e.ym}: 청약철회는 체결 다음 달까지`);
        state = "ENDED";
        break;
      case "LAPSE":
        if (state !== "INFORCE") out.push(`LAPSE ${e.ym}: 유지 중이 아님`);
        state = "LAPSED";
        break;
      case "REINSTATE":
        if (state !== "LAPSED") out.push(`REINSTATE ${e.ym}: 실효 상태가 아님`);
        state = "INFORCE";
        break;
      case "REDUCE":
        if (state !== "INFORCE") out.push(`REDUCE ${e.ym}: 유지 중이 아님`);
        if (reduced) out.push(`REDUCE ${e.ym}: 감액은 한 번만`);
        reduced = true;
        break;
      case "PAYMENT_OVERDUE":
        out.push("PAYMENT_OVERDUE: 데모 엔진은 발행하지 않는다(상위 §4.2)");
        break;
    }
  }
  return out;
}

/** 계약 1건의 문제 목록. forced 계약도 같은 규칙을 지킨다(단, 설계사별 제약은 LLM 계약에만). */
export function contractProblems(c: PlanContract, opts: { llm: boolean }): string[] {
  const out: string[] = [];
  const p = PRODUCTS.find((x) => x.key === c.productKey);
  if (!p) out.push(`productKey ${c.productKey}: 모르는 상품`);
  if (!isValidDate(c.contractDate)) out.push(`contractDate ${c.contractDate}: 날짜 아님`);
  else if (c.contractDate < CONTRACT_FROM || c.contractDate > CONTRACT_TO) out.push(`contractDate ${c.contractDate}: 범위 ${CONTRACT_FROM}~${CONTRACT_TO} 밖`);
  if (!Number.isSafeInteger(c.monthlyPremium) || c.monthlyPremium % 1000 !== 0) out.push(`monthlyPremium ${c.monthlyPremium}: 천 원 단위 정수 아님`);
  if (p && (c.monthlyPremium < p.premiumMin || c.monthlyPremium > p.premiumMax)) out.push(`monthlyPremium ${c.monthlyPremium}: ${p.key} 범위 ${p.premiumMin}~${p.premiumMax} 밖`);
  try {
    agent(c.agentId);
  } catch {
    out.push(`agentId ${c.agentId}: 모르는 설계사`);
  }
  out.push(...lifecycleProblems(c));
  if (opts.llm) {
    const k = AGENT_CONSTRAINTS[c.agentId];
    if (k?.contractFrom && c.contractDate < k.contractFrom) out.push(`${c.agentId}: 체결일은 ${k.contractFrom} 이후`);
    if (k?.excludeMonths?.includes(ymOf(c.contractDate))) out.push(`${c.agentId}: ${ymOf(c.contractDate)} 체결 금지`);
    if (k?.noLifecycle && c.lifecycle.length > 0) out.push(`${c.agentId}: 계약 이벤트 금지`);
    if (c.lifecycle.some((e) => e.event === "WITHDRAW")) out.push("WITHDRAW: 필수 케이스 전용");
  }
  return out;
}
