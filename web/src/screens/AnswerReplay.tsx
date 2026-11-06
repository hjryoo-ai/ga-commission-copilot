// 화면 7 답변 재현(설계서 §8-7, 본인 세션만 — 남의 답변은 서버가 404): 질문 → 정규화 → 검색 청크(점수) → 툴 호출·결과 → 프롬프트(버전 링크)
// → 모델 출력 → 검증 결과 순서의 세로 타임라인. LLM을 부르지 않는다 — 툴 결과는 서버가 저장된 인자로 다시 실행한 것이고 resultHash 일치를 배지로 보인다.
// 검증 결과는 answer_log.violations(설계서 v0.1.25, 0006)의 위반 토큰을 하나씩 표시한다. 거부 전 모델 원문은 저장하지 않는다(llm_trace만).
import type { ReactNode } from "react";
import type { AnswerReplay, Violations } from "../api";
import { api } from "../api";
import { kstDate } from "../format";
import { GROUNDING_LABEL, REFUSE_LABEL } from "../labels";
import { Badge, Status, useLoad } from "../ui";
import { Shell } from "./Shell";

const REPO = "https://github.com/hjryoo-ai/ga-commission-copilot/blob/main/prompts";

/** "answer/v3" → 저장소의 프롬프트 파일 링크(형식이 다르면 링크 없음). */
export function promptHref(version: string): string | null {
  const m = version.match(/^([a-z_]+)\/(v[0-9]+)$/);
  return m ? `${REPO}/${m[1]}/${m[2]}.md` : null;
}

const VIOLATION_GROUPS: readonly { key: keyof Violations; title: string }[] = [
  { key: "g1Shape", title: "G1 모양 오류" },
  { key: "g4Missing", title: "G4 근거에 없는 숫자" },
  { key: "g5Unknown", title: "G5 확인되지 않은 인용" },
  { key: "g6Words", title: "G6 금지 표현·코드" },
];

/** 모양 오류 사유 코드 → 화면 문구(설계서 v0.1.26). 코드 원문은 옆에 작게. */
const SHAPE_LABEL: Record<string, string> = {
  EMPTY_BODY: "빈 본문",
  SHAPE: "응답 모양",
  TOOL_ARG_REJECTED: "툴 인자 거부",
  TOOL_IN_STAGE2: "2단계 툴 요청",
};

function TokenChip({ group, token }: { group: keyof Violations; token: string }) {
  if (group !== "g1Shape") return <li className="chip violation mono">{token}</li>;
  const code = token.split(":")[0]!;
  return (
    <li className="chip violation">
      모양 오류 · {SHAPE_LABEL[code] ?? code} <span className="mono small">{token}</span>
    </li>
  );
}

/** 위반 토큰(화면 7 "실패 토큰 표시"): 종류별로 토큰 하나씩. */
export function ViolationTokens({ v }: { v: Violations | null }) {
  if (!v) return <p className="muted small">위반 기록 없음 — 이 기록이 생기기 전(0006 이전)의 답변입니다.</p>;
  const groups = VIOLATION_GROUPS.filter((g) => (v[g.key] ?? []).length > 0);
  if (groups.length === 0) return <p className="muted small" data-testid="violations">위반 없음(G1·G4·G5·G6)</p>;
  return (
    <div data-testid="violations">
      {groups.map((g) => (
        <div key={g.key}>
          <h4>{g.title}</h4>
          <ul className="chips">
            {v[g.key].map((t, i) => (
              <TokenChip key={`${t}-${i}`} group={g.key} token={t} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li>
      <h3>
        <span className="step">{n}</span> {title}
      </h3>
      {children}
    </li>
  );
}

export function ReplayTimeline({ a }: { a: AnswerReplay }) {
  const href = promptHref(a.promptVersion);
  return (
    <ol className="replay" data-testid="replay">
      <Step n={1} title="질문">
        <p>{a.question}</p>
        <p className="meta">{kstDate(a.createdAt)}</p>
      </Step>
      <Step n={2} title="정규화">
        <p className="mono">{a.normalizedQuestion}</p>
      </Step>
      <Step n={3} title={`검색 청크 ${a.retrievedChunks.length}건`}>
        {a.retrievedChunks.length === 0 ? (
          <p className="muted">검색 결과가 없습니다(규정 없이 답했거나 검색 전에 거부).</p>
        ) : (
          <ul className="plain">
            {a.retrievedChunks.map((c) => (
              <li key={c.chunkId}>
                {c.body ? (
                  <details className="folded">
                    <summary>
                      {c.article} {c.title}
                      <span className="score muted small mono">점수 {c.score.toFixed(3)}</span>
                    </summary>
                    <p className="small">{c.body}</p>
                  </details>
                ) : (
                  <span className="muted">
                    {c.chunkId} <span className="small mono">점수 {c.score.toFixed(3)}</span> — 본문 없음
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Step>
      <Step n={4} title={`툴 호출 ${a.toolCalls.length}건`}>
        {a.toolCalls.length === 0 ? (
          <p className="muted">툴을 부르지 않았습니다.</p>
        ) : (
          <ul className="plain">
            {a.toolCalls.map((t, i) => (
              <li key={`${String(t.tool)}-${i}`} data-testid="tool-call">
                <p className="mono">
                  {t.tool}({Object.entries(t.args ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}) · {t.resultHash}
                </p>
                <Badge tone={t.reproduced ? "plain" : "warn"}>{t.reproduced ? "재현 일치" : "재현 불일치"}</Badge>
                {t.truncated && <span className="muted small"> 결과 요약됨(1,200토큰 상한)</span>}
                {t.result !== undefined && (
                  <details className="folded">
                    <summary>지금 다시 실행한 결과</summary>
                    <pre className="mono small">{JSON.stringify(t.result, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Step>
      <Step n={5} title="프롬프트">
        <p className="mono">{href ? <a href={href}>{a.promptVersion}</a> : a.promptVersion}</p>
      </Step>
      <Step n={6} title="모델 출력">
        <p className="meta">
          {a.provider} · {a.model} · {a.latencyMs}ms{a.fallbackDepth > 0 ? ` · 폴백 ${a.fallbackDepth}단계` : ""}
        </p>
        {a.refused ? (
          <>
            <p>
              <Badge tone="warn">{a.reason ? REFUSE_LABEL[a.reason] : "답하지 않음"}</Badge>
            </p>
            <p className="explain-text">{a.answer}</p>
            <p className="muted small">거부 답은 고정 문구로 저장한다 — 모델이 쓴 원문은 남기지 않는다(검증 위반 토큰은 아래).</p>
          </>
        ) : (
          <p className="explain-text">{a.answer}</p>
        )}
      </Step>
      <Step n={7} title="검증 결과">
        <p>
          <Badge tone={a.groundingStatus === "FAIL" ? "crit" : a.groundingStatus === "PASS" ? "plain" : "muted"}>{GROUNDING_LABEL[a.groundingStatus]}</Badge>
        </p>
        <ViolationTokens v={a.violations} />
        {a.numbersUsed.length > 0 && (
          <>
            <h4>사용된 숫자</h4>
            <ul className="chips">
              {a.numbersUsed.map((x, i) => (
                <li key={`${x}-${i}`} className="chip">
                  {x}
                </li>
              ))}
            </ul>
          </>
        )}
        {a.citations.length > 0 && (
          <>
            <h4>인용</h4>
            <ul className="plain mono">
              {a.citations.map((c, i) => (
                <li key={`${c.kind}-${i}`}>{c.kind === "tool" ? `${c.tool} · ${c.field}` : `${c.article}(${c.chunkId})`}</li>
              ))}
            </ul>
          </>
        )}
      </Step>
    </ol>
  );
}

export function AnswerReplayScreen({ answerId }: { answerId: string }) {
  const s = useLoad(() => api.answer(answerId), [answerId]);
  return (
    <Shell asOf={s.state === "ok" ? s.data.asOf : undefined} title="답변 재현">
      <Status s={s} empty="이 세션의 답변이 아닙니다" />
      {s.state === "ok" && <ReplayTimeline a={s.data} />}
    </Shell>
  );
}
