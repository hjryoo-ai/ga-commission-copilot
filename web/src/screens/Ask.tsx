// 화면 4 자유 질문(설계서 §8-4, PHASES Phase 4 항목 5): 입력창 + 예시 질문 칩 6개 · 답변 카드(본문·인용·툴 호출 펼침·공급자·모델·지연·재현 링크)
// · 거부 카드(사유별 고정 문구 — 서버 text 그대로 + 대안 동선) · 예산 소진(429 BUDGET)이면 입력창 비활성 + 남은 시간.
// · 사람 확인(설계서 v0.1.29 — /me turnstile.required이고 아직 아니면 위젯, 끝나기 전 입력창 비활성) · 분당 한도(429 RATE_LIMITED)는 그 질문에 남은 초.
// 화면은 답의 숫자를 계산·대조하지 않는다(검증은 서버 G4~G6). LLM 본문은 큰 숫자 자리에 두지 않는다.
import { type FormEvent, useCallback, useState } from "react";
import { api, type AskBudget, type AskResult, HumanCheckRequired, type MeTurnstile, questionsLeft, RateLimited, Unauthenticated, withAskBudget } from "../api";
import { DISCLAIMER } from "../disclaimer";
import { EXAMPLE_QUESTIONS } from "../examples";
import { waitText } from "../format";
import { GROUNDING_LABEL, REFUSE_LABEL } from "../labels";
import { Link, navigate, paths } from "../router";
import { Badge, Status, useLoad } from "../ui";
import { HumanCheck } from "./HumanCheck";
import { Shell } from "./Shell";

const QUESTION_MAX = 500;

/** 거부 사유별 대안 동선(설계서 §8-4 "라인 상세로 이동 등"). */
function Alternatives({ r }: { r: AskResult }) {
  switch (r.reason) {
    case "NOT_GROUNDED":
      return (
        <p>
          데이터는 <Link to={paths.statement()}>명세</Link>·<Link to={paths.limits()}>한도</Link> 화면에서 직접 볼 수 있습니다.
        </p>
      );
    case "OTHER_AGENT":
      return (
        <p>
          <Link to={paths.statement()}>내 명세 보기</Link>
        </p>
      );
    case "NEEDS_ENGINE":
      return (
        <p>
          지금 값은 <Link to={paths.limits()}>한도 현황</Link>과 <Link to={paths.statement()}>명세</Link>에서 볼 수 있습니다.
        </p>
      );
    case "BUDGET":
      return (
        <p>
          {r.retryAfterSeconds !== undefined ? `${waitText(r.retryAfterSeconds)} 뒤(00:00 UTC) 다시 질문할 수 있습니다. ` : ""}
          <Link to={paths.statement()}>명세</Link>의 사전 생성 설명은 계속 볼 수 있습니다.
        </p>
      );
    default:
      return <p className="muted">아래 예시 질문처럼 내 명세·한도·분급·규정에 관해 물어 보세요.</p>;
  }
}

export function RefusalCard({ r }: { r: AskResult }) {
  return (
    <article className="card answer refusal" data-testid="refusal">
      <p>
        <Badge tone="warn">{r.reason ? REFUSE_LABEL[r.reason] : "답하지 않음"}</Badge>
      </p>
      <p className="explain-text">{r.text}</p>
      <Alternatives r={r} />
      <p className="disclaimer">{DISCLAIMER}</p>
      <p className="meta">
        <Link to={paths.answer(r.answerId)}>이 답변 재현 보기</Link>
      </p>
    </article>
  );
}

export function AnswerCard({ r }: { r: AskResult }) {
  if (r.refused) return <RefusalCard r={r} />;
  const cites = r.citations ?? [];
  const tools = r.toolCalls ?? [];
  return (
    <article className="card answer" data-testid="answer">
      <p>
        <Badge>{GROUNDING_LABEL[r.groundingStatus ?? "PASS"]}</Badge> <span className="muted small">{r.promptVersion}</span>
      </p>
      {r.rulesUnavailable && <p className="muted small">규정 검색을 쓸 수 없어 데이터만으로 답했습니다.</p>}
      <p className="explain-text">{r.text}</p>
      <p className="disclaimer">{DISCLAIMER}</p>
      {cites.length > 0 && (
        <>
          <h4>인용</h4>
          <ul className="plain mono" data-testid="citations">
            {cites.map((c, i) => (
              <li key={`${c.kind}-${i}`}>{c.kind === "tool" ? `${c.tool} · ${c.field}` : `${c.article}(${c.chunkId})`}</li>
            ))}
          </ul>
        </>
      )}
      {tools.length > 0 && (
        <details className="folded">
          <summary>툴 호출 {tools.length}건</summary>
          <ul className="plain mono">
            {tools.map((t, i) => (
              <li key={`${t.tool}-${i}`}>
                {t.tool}({Object.entries(t.args)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}) · {t.resultHash}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="meta">
        {[r.provider, r.model, r.latencyMs !== undefined ? `${r.latencyMs}ms` : null].filter(Boolean).join(" · ")}
        {" · "}
        <Link to={paths.answer(r.answerId)}>이 답변 재현 보기</Link>
      </p>
    </article>
  );
}

/**
 * 사람 확인 위젯을 그릴지(설계서 v0.1.31). human = 이 화면에서 마쳤으면 true, /ask가 403을 주면 false(쿠키 만료·IP가 바뀜 — 쿠키는 IP에 묶인다),
 * 아직 모르면 null(불러온 /me의 verified를 따른다). 403 뒤에는 위젯이 새로 그려져 다시 확인할 수 있다.
 */
export function humanCheckNeeded(t: MeTurnstile | undefined, human: boolean | null): boolean {
  return Boolean(t?.required && t.siteKey) && !(human ?? t?.verified);
}

type Exchange = { question: string } & ({ state: "pending" } | { state: "ok"; r: AskResult } | { state: "error" } | { state: "rate"; seconds: number } | { state: "human" });

export function Ask() {
  const me = useLoad(() => api.me(), []);
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState<Exchange[]>([]);
  const [budgetOut, setBudgetOut] = useState<number | null>(null);
  // 최근 /ask 응답의 남은 질문(200·429 BUDGET·RATE_LIMITED — 설계서 v0.1.33): 칩과 입력창 비활성 판정이 이 값을 쓴다
  const [latest, setLatest] = useState<AskBudget | undefined>(undefined);
  const pending = log.some((x) => x.state === "pending");
  // 설계서 v0.1.27: 불러올 때 이미 남은 질문이 0이면 처음부터 비활성(다음 00:00 UTC까지)
  const current = me.state === "ok" ? withAskBudget(me.data.budget, latest) : undefined;
  const loadedOut = current && questionsLeft(current) === 0 ? Math.max(0, (Date.parse(current.resetsAt) - Date.now()) / 1000) : null;
  const out = budgetOut ?? loadedOut;
  // 사람 확인: 불러온 값(verified) 또는 이 화면에서 마친 뒤(true)·403을 받은 뒤(false)
  const [human, setHuman] = useState<boolean | null>(null);
  const turnstile = me.state === "ok" ? me.data.turnstile : undefined;
  const needsHuman = humanCheckNeeded(turnstile, human);
  const onVerified = useCallback(() => setHuman(true), []);
  const disabled = pending || out !== null || needsHuman;

  async function send(q: string) {
    const text = q.trim();
    if (!text || text.length > QUESTION_MAX || disabled) return;
    setQuestion("");
    setLog((l) => [{ question: text, state: "pending" }, ...l]);
    const done = (x: Exchange) => setLog((l) => l.map((e, i) => (i === 0 && e.state === "pending" ? x : e)));
    try {
      const r = await api.ask(text);
      if (r.budget) setLatest(r.budget);
      if (r.reason === "BUDGET") setBudgetOut(r.retryAfterSeconds ?? 0);
      done({ question: text, state: "ok", r });
    } catch (e) {
      if (e instanceof Unauthenticated) return navigate(paths.select(), true);
      if (e instanceof RateLimited) {
        if (e.budget) setLatest(e.budget);
        return done({ question: text, state: "rate", seconds: e.retryAfterSeconds });
      }
      if (e instanceof HumanCheckRequired) {
        setHuman(false);
        // 막 쓴 질문을 입력창에 되돌린다 — 다시 확인한 뒤 그대로 보낼 수 있게(모바일 망 전환으로 IP가 바뀐 경우 등)
        setQuestion(text);
        return done({ question: text, state: "human" });
      }
      // 공급자 실패(503 Unavailable)·그 밖의 오류 — 둘 다 "잠시 후 다시"
      done({ question: text, state: "error" });
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };

  return (
    <Shell asOf={me.state === "ok" ? me.data.asOf : undefined} title="자유 질문" budget={latest}>
      <Status s={me} />
      {needsHuman && turnstile?.siteKey && <HumanCheck siteKey={turnstile.siteKey} onVerified={onVerified} />}
      <form className="ask" onSubmit={onSubmit} aria-label="질문">
        <label htmlFor="question" className="small muted">
          내 명세·한도·분급·사규에 관해 묻습니다. 계산·예측·고객 제시용 문구는 답하지 않습니다.
        </label>
        <textarea id="question" value={question} maxLength={QUESTION_MAX} rows={3} disabled={disabled} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" disabled={disabled || question.trim() === ""}>
          {pending ? "답하는 중…" : "질문하기"}
        </button>
        {out !== null && (
          <p className="muted small" data-testid="budget-out">
            오늘 질문 예산이 소진되었습니다 — {waitText(out)} 뒤 다시 질문할 수 있습니다. 명세의 사전 생성 설명은 계속 볼 수 있습니다.
          </p>
        )}
      </form>
      <ul className="chips examples" aria-label="예시 질문">
        {EXAMPLE_QUESTIONS.map((x) => (
          <li key={x.id}>
            <button type="button" className="chip" disabled={disabled} onClick={() => void send(x.question)}>
              {x.question}
            </button>
          </li>
        ))}
      </ul>
      <section aria-live="polite">
        {log.map((x, i) => (
          <div key={log.length - i} className="exchange">
            <p className="question">Q. {x.question}</p>
            {x.state === "pending" && <p className="muted">답하는 중…</p>}
            {x.state === "error" && <p className="muted">잠시 후 다시 시도하세요</p>}
            {x.state === "rate" && <p className="muted">질문이 잦습니다 — {x.seconds}초 뒤 다시 질문하세요.</p>}
            {x.state === "human" && <p className="muted">사람 확인이 만료되었거나 네트워크가 바뀌었습니다 — 위에서 다시 확인한 뒤 질문하세요(질문은 입력창에 남겨 두었습니다).</p>}
            {x.state === "ok" && <AnswerCard r={x.r} />}
          </div>
        ))}
      </section>
    </Shell>
  );
}
