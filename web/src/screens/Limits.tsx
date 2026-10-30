// 화면 3 한도 현황(설계서 §8-3, 상위 §8-2·§6.3): 필터(주의/전체) · 계약 카드(소진 바·잔여·단계·플래그) · 상세(산식·타임라인·삭감·한도 이력 요약 설명).
import { type CSSProperties, useState } from "react";
import { api, type Ledger } from "../api";
import { won } from "../format";
import { CONTRACT_LABEL, CUT_LABEL, DEFER_NOTE, FLAG_LABEL, LEDGER_LABEL, STAGE_LABEL } from "../labels";
import { citedClass, ExplanationBody } from "../explain";
import { Link, paths } from "../router";
import { Amount, Badge, Status, useLoad } from "../ui";
import { Shell } from "./Shell";

const tone = (stage: Ledger["stage"]) => (stage === "OK" ? "plain" : stage === "WARN" ? "warn" : "crit");

/** 소진 바: utilization 문자열을 숫자로 바꾸지 않고 CSS 속성으로(상위 §8 구현 규약). 한도 0이면 바 없음. 백분율 글자는 바 바깥(채움과 겹치지 않게 — Phase 2 남은 이슈 3). */
export function UsageBar({ utilization, className }: { utilization?: string; className?: string }) {
  if (!utilization) return <p className="muted">한도 0 — 소진율 없음</p>;
  return (
    <div className={className ? `usage ${className}` : "usage"} role="img" aria-label={`소진율 ${utilization}`}>
      <span className="bar">
        <span className="fill" style={{ "--w": utilization } as CSSProperties} />
      </span>
      <span className="pct">{utilization}</span>
    </div>
  );
}

function LedgerCard({ l }: { l: Ledger }) {
  return (
    <Link to={paths.limit(l.ledgerId)} className="card ledger" data-testid="ledger-card">
      <span className="title">
        {l.productKey ?? "상품 정보 없음"} · {l.policyMasked}
      </span>
      <span className="meta">체결 {l.contractDate} · 초년도 종료 {l.fyEnd}</span>
      <UsageBar utilization={l.utilization} />
      <span>
        잔여 <Amount value={l.remaining} label={LEDGER_LABEL} />
      </span>
      <span className="badges">
        <Badge tone={tone(l.stage)}>{STAGE_LABEL[l.stage]}</Badge>
        {l.flags.map((f) => (
          <Badge key={f} tone="muted">
            {FLAG_LABEL[f] ?? f}
          </Badge>
        ))}
      </span>
    </Link>
  );
}

export function Limits() {
  const s = useLoad(() => api.limits(), []);
  const [onlyAlert, setOnlyAlert] = useState(false);
  const items = s.state === "ok" ? s.data.items.filter((l) => !onlyAlert || l.stage !== "OK") : [];
  return (
    <Shell asOf={s.state === "ok" ? s.data.asOf : undefined} title="한도 현황">
      <div className="filter" role="group" aria-label="필터">
        <button type="button" aria-pressed={!onlyAlert} onClick={() => setOnlyAlert(false)}>
          전체
        </button>
        <button type="button" aria-pressed={onlyAlert} onClick={() => setOnlyAlert(true)}>
          주의
        </button>
      </div>
      <Status s={s} />
      {s.state === "ok" && (
        <>
          {s.data.items.length === 0 && <p className="muted">한도 원장이 있는 계약이 없습니다(2026-07-01 이전 체결 계약은 한도 미적용)</p>}
          <ul className="cards" data-testid="ledgers">
            {items.map((l) => (
              <li key={l.ledgerId}>
                <LedgerCard l={l} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}

export function LimitDetail({ ledgerId }: { ledgerId: string }) {
  const s = useLoad(() => api.limit(ledgerId), [ledgerId]);
  const d = s.state === "ok" ? s.data : undefined;
  const [cited, setCited] = useState<string[] | null>(null);
  const hl = (...f: string[]) => citedClass(cited, ...f);
  return (
    <Shell asOf={d?.asOf} title="한도 상세">
      <Status s={s} />
      {d && (
        <>
          <section className="card" data-testid="limit-detail">
            <h2>
              {d.ledger.productKey ?? "상품 정보 없음"} · {d.ledger.policyMasked} <Badge tone={tone(d.ledger.stage)}>{STAGE_LABEL[d.ledger.stage]}</Badge>
            </h2>
            {/* 산식은 표시 문자열 — 곱하지 않는다 */}
            <p className={hl("ledger.monthlyPremium", "ledger.limitMultiple", "ledger.limitAmount") ? "formula cited" : "formula"}>
              월납 {won(d.ledger.monthlyPremium)}({CONTRACT_LABEL}) × {d.ledger.limitMultiple}배 → 한도 {won(d.ledger.limitAmount)}({LEDGER_LABEL})
            </p>
            <UsageBar utilization={d.ledger.utilization} className={hl("derived.utilization", "derived.stage")} />
            <dl>
              <dt>누적</dt>
              <dd className={hl("ledger.accumPaid")}>
                <Amount value={d.ledger.accumPaid} label={LEDGER_LABEL} />
              </dd>
              <dt>잔여</dt>
              <dd className={hl("derived.remaining")}>
                <Amount value={d.ledger.remaining} label={LEDGER_LABEL} />
              </dd>
              {d.ledger.cutTotal > 0 && (
                <>
                  <dt>{CUT_LABEL}</dt>
                  <dd className={hl("ledger.cutTotal")}>
                    <Amount value={d.ledger.cutTotal} label={LEDGER_LABEL} />
                  </dd>
                </>
              )}
              {d.ledger.deferredTotal > 0 && (
                <>
                  <dt>{CUT_LABEL}</dt>
                  <dd className={hl("ledger.deferredTotal")}>
                    <Amount value={d.ledger.deferredTotal} label={LEDGER_LABEL} /> <span className="muted">{DEFER_NOTE}</span>
                  </dd>
                </>
              )}
              <dt>초년도</dt>
              <dd className={hl("ledger.fyStart", "ledger.fyEnd")}>
                {d.ledger.fyStart} ~ {d.ledger.fyEnd}
              </dd>
            </dl>
            <p className="badges">
              {d.ledger.flags.map((f) => (
                <Badge key={f} tone="muted">
                  {FLAG_LABEL[f] ?? f}
                </Badge>
              ))}
            </p>
          </section>
          <section>
            <h3>원장 타임라인</h3>
            <ol className="timeline" data-testid="limit-history">
              {d.history.map((h, i) => (
                <li key={h.sourceSeq} className={hl(`history.${i}`)}>
                  <span className="when">{h.occurredAt.slice(0, 10)}</span>{" "}
                  {h.kind === "POST" ? (
                    <>
                      전기 {h.amount !== undefined && <Amount value={h.amount} label={LEDGER_LABEL} />} → 누적 <Amount value={h.accumAfter} label={LEDGER_LABEL} />
                      {h.calcId && (
                        <>
                          {" "}
                          <Link to={paths.line(h.calcId)}>라인</Link>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      재산정 → 한도 <Amount value={h.limitAfter} label={LEDGER_LABEL} />
                      {h.reason ? ` (${h.reason})` : ""}
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <section className="explain">
            <h3>한도 이력 요약</h3>
            <ExplanationBody e={d.explanation} onCite={setCited} />
          </section>
          <p>
            <Link to={paths.limits()}>한도 현황으로</Link>
          </p>
        </>
      )}
    </Shell>
  );
}
