// contracts/plan/v1/plan.schema.json과 같은 모양(TS 쪽 타입). 검증의 정본은 JSON Schema(G1)다.

export type LifecycleEventType = "CANCEL" | "LAPSE" | "WITHDRAW" | "REDUCE" | "REINSTATE" | "PAYMENT_OVERDUE";

export interface LifecycleEvent {
  ym: string;
  event: LifecycleEventType;
}

export interface PlanContract {
  policyNo: string;
  agentId: string;
  productKey: string;
  contractDate: string;
  monthlyPremium: number;
  lifecycle: LifecycleEvent[];
  forcedCase?: string;
}

export interface Plan {
  contracts: PlanContract[];
}

/** LLM이 설계사 1명 몫으로 돌려주는 모양(contracts/plan/v1/plan-llm.schema.json). policyNo·agentId는 코드가 붙인다. */
export interface LlmContract {
  productKey: string;
  contractDate: string;
  monthlyPremium: number;
  lifecycle: { ym: string; event: "CANCEL" | "LAPSE" | "REDUCE" | "REINSTATE" }[];
}

export interface LlmPlanChunk {
  contracts: LlmContract[];
}
