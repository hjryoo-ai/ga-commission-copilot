// 툴 목록과 실행기(설계서 §4.3, PHASES Phase 4 항목 2). LLM이 고른 툴 이름·인자는 여기서 검사하고, agentId는 받지 않는다(세션의 ScopedQuery).
import { getDeferrals } from "./deferrals";
import { getLimit } from "./limit";
import { getPolicyEventSim } from "./policyEventSim";
import { serialize, type ToolContext, type ToolData } from "./result";
import { getStatement } from "./statement";

export const TOOL_NAMES = ["get_statement", "get_limit", "get_deferrals", "get_policy_event_sim"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const YM = /^[0-9]{4}(0[1-9]|1[0-2])$/;
const POLICY_ARG = /^[*\-0-9A-Za-z가-힣 ]{4,32}$/;
/** get_deferrals 기간 상한(달 수) — 읽기 API 범위 상한과 같다. */
const RANGE_MAX = 36;

/** 인자 스키마(LLM 계획 출력의 toolCalls[].args 검사). 알 수 없는 키·agentId는 거부. */
const ARGS: Readonly<Record<ToolName, readonly string[]>> = {
  get_statement: ["ym"],
  get_limit: ["policyNo"],
  get_deferrals: ["from", "to"],
  get_policy_event_sim: ["policyNo"],
};

export interface ToolCall {
  tool: ToolName;
  args: Record<string, string>;
}

export interface ToolResult {
  tool: ToolName;
  args: Record<string, string>;
  data: ToolData;
  /** 직렬화 토큰 추정(≤ 1,200). */
  tokens: number;
  truncated: boolean;
}

export class InvalidToolCall extends Error {}

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;

/** 툴 호출 검사: 이름이 목록에 있고, 인자 키가 정확히 그 툴의 것이며, 값 형식이 맞아야 한다. */
export function parseToolCall(raw: unknown): ToolCall {
  if (!raw || typeof raw !== "object") throw new InvalidToolCall("tool call 형식 아님");
  const { tool, args } = raw as { tool?: unknown; args?: unknown };
  if (typeof tool !== "string" || !(TOOL_NAMES as readonly string[]).includes(tool)) throw new InvalidToolCall(`알 수 없는 툴 ${String(tool)}`);
  const name = tool as ToolName;
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new InvalidToolCall("args 형식 아님");
  const keys = Object.keys(args).sort();
  const want = [...ARGS[name]].sort();
  if (keys.join() !== want.join()) throw new InvalidToolCall(`${name} 인자 ${keys.join(",")} ≠ ${want.join(",")}`);
  const a = args as Record<string, unknown>;
  for (const k of want) if (typeof a[k] !== "string") throw new InvalidToolCall(`${name}.${k} 문자열 아님`);
  const s = a as Record<string, string>;
  if (name === "get_statement" && !YM.test(s.ym!)) throw new InvalidToolCall("ym 형식 아님(yyyyMM)");
  if ((name === "get_limit" || name === "get_policy_event_sim") && !POLICY_ARG.test(s.policyNo!)) throw new InvalidToolCall("policyNo 형식 아님");
  if (name === "get_deferrals") {
    if (!YM.test(s.from!) || !YM.test(s.to!)) throw new InvalidToolCall("from·to 형식 아님(yyyyMM)");
    const span = monthIndex(s.to!) - monthIndex(s.from!);
    if (span < 0 || span >= RANGE_MAX) throw new InvalidToolCall(`기간 ${span + 1}개월(1~${RANGE_MAX})`);
  }
  return { tool: name, args: s };
}

export async function runTool(ctx: ToolContext, call: ToolCall): Promise<ToolResult> {
  const a = call.args;
  const r =
    call.tool === "get_statement"
      ? await getStatement(ctx, a.ym!)
      : call.tool === "get_limit"
        ? await getLimit(ctx, a.policyNo!)
        : call.tool === "get_deferrals"
          ? await getDeferrals(ctx, a.from!, a.to!)
          : await getPolicyEventSim(ctx, a.policyNo!);
  return { tool: call.tool, args: call.args, ...r };
}

export { serialize };
