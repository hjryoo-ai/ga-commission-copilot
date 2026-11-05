// 화면 4 자유 질문(설계서 §8-4, PHASES Phase 4 항목 5): 입력창 + 예시 질문 칩 6개 · 답변 카드(본문·인용·툴 호출 펼침·공급자·모델·지연·재현 링크)
// · 거부 카드(사유별 고정 문구 — 서버 text 그대로 + 대안 동선) · 예산 소진(429 BUDGET)이면 입력창 비활성 + 남은 시간.
// 화면은 답의 숫자를 계산·대조하지 않는다(검증은 서버 G4~G6). LLM 본문은 큰 숫자 자리에 두지 않는다.
import { type FormEvent, useState } from "react";
import { api, type AskResult, Unauthenticated } from "../api";
import { DISCLAIMER } from "../disclaimer";
import { EXAMPLE_QUESTIONS } from "../examples";
import { waitText } from "../format";
import { GROUNDING_LABEL, REFUSE_LABEL } from "../labels";
import { Link, navigate, paths } from "../router";
import { Badge, Status, useLoad } from "../ui";
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

type Exchange = { question: string } & ({ state: "pending" } | { state: "ok"; r: AskResult } | { state: "error" });

export function Ask() {
  const me = useLoad(() => api.me(), []);
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState<Exchange[]>([]);
  const [budgetOut, setBudgetOut] = useState<number | null>(null);
  const pending = log.some((x) => x.state === "pending");
  const disabled = pending || budgetOut !== null;

  async function send(q: string) {
    const text = q.trim();
    if (!text || text.length > QUESTION_MAX || disabled) return;
    setQuestion("");
    setLog((l) => [{ question: text, state: "pending" }, ...l]);
    const done = (x: Exchange) => setLog((l) => l.map((e, i) => (i === 0 && e.state === "pending" ? x : e)));
    try {
      const r = await api.ask(text);
      if (r.reason === "BUDGET") setBudgetOut(r.retryAfterSeconds ?? 0);
      done({ question: text, state: "ok", r });
    } catch (e) {
      if (e instanceof Unauthenticated) return navigate(paths.select(), true);
      // 공급자 실패(503 Unavailable)·그 밖의 오류 — 둘 다 "잠시 후 다시"
      done({ question: text, state: "error" });
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };

  return (
    <Shell asOf={me.state === "ok" ? me.data.asOf : undefined} title="자유 질문">
      <Status s={me} />
      <form className="ask" onSubmit={onSubmit} aria-label="질문">
        <label htmlFor="question" className="small muted">
          내 명세·한도·분급·사규에 관해 묻습니다. 계산·예측·고객 제시용 문구는 답하지 않습니다.
        </label>
        <textarea id="question" value={question} maxLength={QUESTION_MAX} rows={3} disabled={disabled} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" disabled={disabled || question.trim() === ""}>
          {pending ? "답하는 중…" : "질문하기"}
        </button>
        {budgetOut !== null && (
          <p className="muted small" data-testid="budget-out">
            오늘 질문 예산이 소진되었습니다 — {waitText(budgetOut)} 뒤 다시 질문할 수 있습니다.
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
            {x.state === "ok" && <AnswerCard r={x.r} />}
          </div>
        ))}
      </section>
    </Shell>
  );
}
