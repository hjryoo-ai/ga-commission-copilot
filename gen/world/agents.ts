// 데모 테넌트 설계사 30명(상위 부록 B: 본부 1 · 지점 2 · 팀 6). 이름은 허구(실존 인물 금지 — 설계서 §9).
// 데모 설계사 1·2·3 = A-1001(A-1 한도 초과·해약)·A-1002(A-2 분급)·A-1003(A-3 감액 재산정).

export interface Agent {
  agentId: string;
  no: number;
  name: string;
  grade: "SR" | "MR" | "JR";
  orgPath: string;
  /** LLM이 채울 비강제 계약 수(부록 B.3: 설계사별 8~20) */
  llmContracts: number;
}

export const AGENTS: readonly Agent[] = Array.from({ length: 30 }, (_, i) => {
  const no = i + 1;
  const team = Math.floor(i / 5) + 1;
  const branch = team <= 3 ? 1 : 2;
  return {
    agentId: `A-${1000 + no}`,
    no,
    name: `허구설계사${String(no).padStart(2, "0")}`,
    grade: no <= 10 ? "SR" : no <= 20 ? "MR" : "JR",
    orgPath: `/HQ1/BR${String(branch).padStart(2, "0")}/TM${String(team).padStart(2, "0")}`,
    llmContracts: 8 + ((i * 5) % 13),
  };
});

export const DEMO_AGENTS = ["A-1001", "A-1002", "A-1003"] as const;

export function agent(agentId: string): Agent {
  const a = AGENTS.find((x) => x.agentId === agentId);
  if (!a) throw new Error(`unknown agent ${agentId}`);
  return a;
}

/**
 * 설계사별 추가 제약(LLM 프롬프트 데이터 + 플랜 의미 검사가 같은 값을 쓴다).
 * A-1001: A-1 정본과 payload가 같아야 하므로 그 설계사의 202608·202702 월 합계를 다른 계약이 건드리면 안 된다 —
 *   체결일 2026-03-01 이후(13회차 유지 수수료가 2027-03부터 시작), 2026-08·2027-02 체결 금지, 계약 이벤트 없음.
 * A-1007: 202610 환수가 채권으로 이월돼야 하므로 2026-10 체결 금지.
 */
export interface AgentConstraint {
  contractFrom?: string;
  excludeMonths?: readonly string[];
  noLifecycle?: boolean;
}

export const AGENT_CONSTRAINTS: Readonly<Record<string, AgentConstraint>> = {
  "A-1001": { contractFrom: "2026-03-01", excludeMonths: ["202608", "202702"], noLifecycle: true },
  "A-1007": { excludeMonths: ["202610"] },
};
