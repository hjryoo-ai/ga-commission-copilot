// 화면 6 예산·관측(설계서 §8-6·v0.1.28, PHASES Phase 5 항목 6 — 공개, 세션 없음): 오늘 사용/상한(질문·호출 열을 나눠 — v0.1.33), 최근 7일 일별 사용,
// 폴백 깊이 분포, 캐시 적중, 거부 사유, 규정 검색 저하. 값은 GET /api/v1/budget 그대로 — 화면은 비율(막대 길이)만 계산한다(금액 아님).
// 막대는 계열 하나씩(사용/상한)이라 범주 색이 없다. 모든 값은 표에도 숫자로 있다(색만으로 읽지 않게).
import type { CSSProperties } from "react";
import { api, type BudgetReport, type BudgetProvider } from "../api";
import { Link, paths } from "../router";
import { Footer, Status, useLoad } from "../ui";

export const PROVIDER_LABEL: Record<BudgetProvider, string> = { groq: "Groq", "workers-ai": "Workers AI", openrouter: "OpenRouter" };
const PROVIDERS: readonly BudgetProvider[] = ["groq", "workers-ai", "openrouter"];
const DEPTH_LABEL: Record<"0" | "1" | "2", string> = { "0": "1순위(Groq)", "1": "2순위(Workers AI)", "2": "3순위(OpenRouter)" };
const REFUSE_LABEL: Record<string, string> = {
  OUT_OF_SCOPE: "범위 밖",
  NOT_GROUNDED: "근거로 확인되지 않음",
  OTHER_AGENT: "다른 설계사",
  NEEDS_ENGINE: "엔진 계산 필요",
  BUDGET: "예산 소진",
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n * 1000) / d) / 10}%` : "—");

function UsageRow({ label, used, cap, note }: { label: string; used: number; cap: number; note?: string }) {
  const w = cap > 0 ? `${Math.min(100, (used * 100) / cap)}%` : "0%";
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="usage-cell">
        <div className="usage" role="img" aria-label={`${label} ${used}/${cap}`}>
          <span className="bar">
            <span className="fill" style={{ "--w": w } as CSSProperties} />
          </span>
        </div>
      </td>
      <td className="num">
        {used} / {cap}
        {note && <span className="muted small note-line">{note}</span>}
      </td>
    </tr>
  );
}

/** 표 칸 안 사용/상한 — 숫자 위, 막대 아래(좁은 화면에서 두 열이 나란히 들어가게). */
function UsageCell({ label, used, cap, note }: { label: string; used: number; cap: number; note?: string }) {
  const w = cap > 0 ? `${Math.min(100, (used * 100) / cap)}%` : "0%";
  return (
    <div className="usage-stack" role="img" aria-label={`${label} ${used}/${cap}`}>
      <span className="num">
        {used} / {cap}
      </span>
      <span className="bar">
        <span className="fill" style={{ "--w": w } as CSSProperties} />
      </span>
      {note && <span className="muted small note-line">{note}</span>}
    </div>
  );
}

export function BudgetView({ b }: { b: BudgetReport }) {
  const depthTotal = b.fallbackDepth["0"] + b.fallbackDepth["1"] + b.fallbackDepth["2"];
  const refusals = Object.entries(b.refusals).sort((x, y) => y[1] - x[1]);
  return (
    <>
      <section>
        <h2>오늘({b.today.day} UTC)</h2>
        <table className="budget split-table" data-testid="budget-today">
          <thead>
            <tr>
              <th scope="col">범위</th>
              <th scope="col">
                질문<span className="muted small note-line">답 1건에 1</span>
              </th>
              <th scope="col">
                호출<span className="muted small note-line">LLM 1회에 1</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">전체</th>
              <td>
                <UsageCell label="전체 질문" used={b.today.global.used} cap={b.today.global.cap} />
              </td>
              <td>
                <UsageCell label="전체 호출" used={b.today.calls.used} cap={b.today.calls.cap} />
              </td>
            </tr>
            {PROVIDERS.map((p) => (
              <tr key={p}>
                <th scope="row">{PROVIDER_LABEL[p]}</th>
                <td className="muted">—</td>
                <td>
                  <UsageCell
                    label={`${PROVIDER_LABEL[p]} 호출`}
                    used={b.today.providers[p].used}
                    cap={b.today.providers[p].cap}
                    note={p === "workers-ai" && b.today.providers[p].cap === 0 ? "설명 배치와 뉴런을 나눠 써 배치 중 0" : undefined}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          질문 상한 = min(전역 상한, 호출 상한 합 ÷ 2의 내림) — 답 1건에 LLM 호출 1~2회(툴이 필요하면 2). 같은 질문을 다시 쓴 답(캐시 히트)은 질문·호출 모두 세지 않는다.
        </p>
      </section>

      <section>
        <h2>최근 7일</h2>
        <table className="budget" data-testid="budget-days">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                날(UTC)
              </th>
              <th scope="col" rowSpan={2}>
                질문
              </th>
              <th scope="colgroup" colSpan={4} className="group">
                호출
              </th>
            </tr>
            <tr>
              <th scope="col">합</th>
              {PROVIDERS.map((p) => (
                <th key={p} scope="col">
                  {PROVIDER_LABEL[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.days.map((d) => (
              <tr key={d.day}>
                <th scope="row" className="mono">
                  {d.day.slice(5)}
                </th>
                <td className="num">{d.questions}</td>
                <td className="num">{d.calls}</td>
                {PROVIDERS.map((p) => (
                  <td key={p} className="num">
                    {d.providers[p]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>폴백 깊이(7일)</h2>
        {depthTotal === 0 ? (
          <p className="muted">LLM이 답한 질문이 아직 없습니다.</p>
        ) : (
          <table className="budget usage-table" data-testid="budget-depth">
            <tbody>
              {(["0", "1", "2"] as const).map((k) => (
                <UsageRow key={k} label={DEPTH_LABEL[k]} used={b.fallbackDepth[k]} cap={depthTotal} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>캐시·거부·저하(7일)</h2>
        <dl>
          <dt>캐시 적중</dt>
          <dd data-testid="budget-cache">
            {b.cache.hit + b.cache.miss === 0 ? "기록 없음" : `${pct(b.cache.hit, b.cache.hit + b.cache.miss)} (${b.cache.hit}/${b.cache.hit + b.cache.miss})`}
          </dd>
          <dt>규정 검색 없이 답함</dt>
          <dd>{b.degraded.rules}건</dd>
        </dl>
        {refusals.length > 0 && (
          <table className="budget" data-testid="budget-refusals">
            <tbody>
              {refusals.map(([code, n]) => (
                <tr key={code}>
                  <th scope="row">{REFUSE_LABEL[code] ?? code}</th>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function Budget() {
  const s = useLoad(() => api.budget(), []);
  return (
    <>
      <header>
        <nav className="tabs" aria-label="화면">
          <Link to={paths.select()}>처음으로</Link>
        </nav>
        <h1>예산·관측</h1>
        <p className="lead">무료 한도 안에서 하루 질문 예산을 공급자별로 나눠 쓴다. 소진되면 자유 질문만 멈추고 사전 생성 설명은 계속 보인다.</p>
      </header>
      <main>
        <Status s={s} />
        {s.state === "ok" && <BudgetView b={s.data} />}
      </main>
      <Footer />
    </>
  );
}
