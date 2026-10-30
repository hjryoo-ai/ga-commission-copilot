// 화면 2 월별 명세(설계서 §8-2, 상위 §8-5·§8 구현 규약): 월 선택 · 월 요약 카드 · 유형별 합계 · 라인 목록(같은 달 취소 짝 접기).
import { useEffect, useState } from "react";
import { allLines, api, type Explanation, type Line, type Month, type MonthStatus } from "../api";
import { kstDate, monthWindow, won, ym as ymText } from "../format";
import { ADJUSTMENT_LABEL, commTypeLabel, CUT_LABEL, grossLabel, lineLabel, MONTH_STATUS_LABEL, netCell } from "../labels";
import { Link, navigate, paths } from "../router";
import { ExplanationBody } from "../explain";
import { Amount, Badge, Status, useLoad } from "../ui";
import { Shell } from "./Shell";

export function MonthCard({ m }: { m: Month }) {
  const net = netCell(m.status, m.netBasis);
  return (
    <section className="card month" data-testid="month-card">
      <h2>
        {ymText(m.closeYm)} <Badge>{MONTH_STATUS_LABEL[m.status]}</Badge>
        {m.monthDataStatus !== "OK" && <Badge tone="warn">대사 불일치</Badge>}
      </h2>
      {net.show && m.net !== undefined ? (
        <p className="headline">
          실수령 <Amount value={m.net} label={net.label} big />
          {net.note === "estimateAsOf" && m.estimateAsOf && <span className="muted"> 기준 {kstDate(m.estimateAsOf)}</span>}
          {net.note === "paidAt" && m.paidAt && <span className="muted"> 지급일 {kstDate(m.paidAt)}</span>}
        </p>
      ) : (
        <p className="headline">
          세전 <Amount value={m.gross} label={grossLabel(m.status, m.netBasis)} big />
          <span className="muted"> {net.show ? "" : net.note}</span>
        </p>
      )}
      <dl>
        <dt>세전</dt>
        <dd>
          <Amount value={m.gross} label={grossLabel(m.status, m.netBasis)} />
        </dd>
        <dt>환수 상계</dt>
        <dd>
          <Amount value={m.clawbackOffset} label={MONTH_STATUS_LABEL[m.status]} />
        </dd>
        <dt>정정</dt>
        <dd>
          <Amount value={m.adjustment} label={ADJUSTMENT_LABEL} />
        </dd>
        {net.show && m.withholdingTax !== undefined && (
          <>
            <dt>원천세</dt>
            <dd>
              <Amount value={m.withholdingTax} label={net.label} />
            </dd>
          </>
        )}
        {m.payoutExpectedOn && (
          <>
            <dt>지급예정일</dt>
            <dd>{m.payoutExpectedOn}</dd>
          </>
        )}
        {m.status === "PAID" && m.paidAmount !== undefined && (
          <>
            <dt>지급액</dt>
            <dd>
              <Amount value={m.paidAmount} label="지급완료" />
            </dd>
          </>
        )}
        {m.status === "PAID" && m.receivableOffset !== undefined && (
          <>
            <dt>채권 상계</dt>
            <dd>
              <Amount value={m.receivableOffset} label="지급완료" />
            </dd>
          </>
        )}
        {m.status === "PAID" && m.carriedReceivable !== undefined && (
          <>
            <dt>이월 채권</dt>
            <dd>
              <Amount value={m.carriedReceivable} label="지급완료" />
            </dd>
          </>
        )}
      </dl>
      <p className="previous">
        {m.previous ? (
          <>
            전월 {ymText(m.previous.closeYm)} 세전 <Amount value={m.previous.gross} label={grossLabel(m.previous.status, m.previous.netBasis)} />
          </>
        ) : (
          "전월 내역 없음"
        )}
      </p>
      <MonthDiffBlock ym={m.closeYm} />
    </section>
  );
}

function ByType({ m }: { m: Month }) {
  return (
    <section>
      <h3>유형별 합계</h3>
      <table className="by-type">
        <tbody>
          {Object.entries(m.byType).map(([t, v]) => (
            <tr key={t}>
              <th scope="row">{commTypeLabel(t)}</th>
              <td>
                <Amount value={v} label={lineLabel(t, m.status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LineRow({ l, ym, status }: { l: Line; ym: string; status: MonthStatus }) {
  return (
    <div className="line-row">
      <Link to={paths.line(l.calcId)} className="line-link" data-testid="line-link">
        <span className="type">{commTypeLabel(l.commType)}</span>
        <span className="policy">
          {l.policyMasked}
          {l.productKey ? ` · ${l.productKey}` : ""}
        </span>
        <Amount value={l.amount} label={lineLabel(l.commType, status)} />
      </Link>
      <span className="badges">
        {l.limitCutAmt > 0 && <Badge tone="warn">{`${CUT_LABEL} ${won(l.limitCutAmt)}`}</Badge>}
        {l.reversedBy && l.reversedByYm !== ym && (
          <Badge tone="muted">{l.reversedByYm ? <Link to={paths.statement(l.reversedByYm)}>{`취소됨 → ${ymText(l.reversedByYm)}`}</Link> : "다른 달의 짝"}</Badge>
        )}
        {l.reversalOf && l.reversalOfYm !== ym && (
          <Badge tone="muted">{l.reversalOfYm ? <Link to={paths.statement(l.reversalOfYm)}>{`취소 ← ${ymText(l.reversalOfYm)}`}</Link> : "다른 달의 짝"}</Badge>
        )}
      </span>
    </div>
  );
}

/** 같은 달 짝만 접는다: 원 라인은 취소 라인 아래 "취소된 원 라인 보기"로(상위 §8 구현 규약). */
export function foldLines(lines: readonly Line[], ym: string): { line: Line; folded?: Line }[] {
  const byId = new Map(lines.map((l) => [l.calcId, l]));
  const hidden = new Set(lines.filter((l) => l.reversalOf && l.reversalOfYm === ym && byId.has(l.reversalOf)).map((l) => l.reversalOf!));
  return lines.filter((l) => !hidden.has(l.calcId)).map((l) => ({ line: l, folded: l.reversalOf && hidden.has(l.reversalOf) ? byId.get(l.reversalOf) : undefined }));
}

function LineList({ ym, status }: { ym: string; status: MonthStatus }) {
  const s = useLoad(() => allLines(ym), [ym]);
  if (s.state !== "ok") return <Status s={s} empty="이 달의 라인이 없습니다" />;
  const rows = foldLines(s.data.lines, ym);
  return (
    <section>
      <h3>라인 {s.data.lines.length}건</h3>
      <ul className="lines" data-testid="lines">
        {rows.map(({ line, folded }) => (
          <li key={line.calcId}>
            <LineRow l={line} ym={ym} status={status} />
            {folded && (
              <details className="folded">
                <summary>취소된 원 라인 보기</summary>
                <LineRow l={folded} ym={ym} status={status} />
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Statement({ ym }: { ym?: string }) {
  const me = useLoad(() => api.me(), []);
  const range = me.state === "ok" && me.data.months ? monthWindow(me.data.months.from, me.data.months.to) : null;

  // 달을 고르지 않았으면 그 설계사의 마지막 달로
  useEffect(() => {
    if (!ym && me.state === "ok" && me.data.months) navigate(paths.statement(me.data.months.to), true);
  }, [ym, me]);

  const list = useLoad(() => (range ? api.earnings(range.from, range.to) : Promise.resolve(null)), [range?.from, range?.to]);
  const month = useLoad(() => (ym ? api.month(ym) : Promise.resolve(null)), [ym]);
  const asOf = month.state === "ok" && month.data ? month.data.asOf : me.state === "ok" ? me.data.asOf : undefined;

  return (
    <Shell asOf={asOf} title="월별 명세">
      {me.state === "ok" && !me.data.months && <p className="muted">명세가 아직 없습니다</p>}
      {list.state === "ok" && list.data && ym && (
        <label className="month-pick">
          월 선택{" "}
          <select value={ym} onChange={(e) => navigate(paths.statement(e.target.value))} data-testid="month-select">
            {[...list.data.items].reverse().map((x) => (
              <option key={x.closeYm} value={x.closeYm}>
                {ymText(x.closeYm)} · {MONTH_STATUS_LABEL[x.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      <Status s={month} empty="이 달 내역이 없습니다" />
      {month.state === "ok" && month.data && ym && (
        <>
          <MonthCard m={month.data} />
          <ByType m={month.data} />
          <LineList ym={ym} status={month.data.status} />
        </>
      )}
    </Shell>
  );
}

/** "전월과 달라진 이유"(설계서 §8 화면 2 — kind=MONTH_DIFF 접힘 블록). 펼칠 때 한 번만 불러온다. */
function MonthDiffBlock({ ym }: { ym: string }) {
  const [state, setState] = useState<{ ym: string; e: Explanation | null } | "loading" | "error" | null>(null);
  const shown = state && typeof state === "object" && state.ym === ym ? state : null;
  const onToggle = (open: boolean) => {
    if (!open || shown || state === "loading") return;
    setState("loading");
    api.diff(ym).then(
      (d) => setState({ ym, e: d.explanation }),
      () => setState("error"),
    );
  };
  return (
    <details className="explain" key={ym} onToggle={(ev) => onToggle((ev.currentTarget as HTMLDetailsElement).open)}>
      <summary>전월과 달라진 이유</summary>
      {state === "loading" && <p className="muted">불러오는 중…</p>}
      {state === "error" && <p className="muted">잠시 후 다시 시도하세요</p>}
      {shown && <ExplanationBody e={shown.e} />}
    </details>
  );
}
