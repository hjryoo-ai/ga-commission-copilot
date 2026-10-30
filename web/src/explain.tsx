// 사전 생성 설명 블록(설계서 §8 화면 2·3, v0.1.14 §7): 본문 · 고정 문구 · "근거 보기"(인용 필드 하이라이트·사용된 숫자) · 검증 배지.
// LLM 텍스트는 큰 숫자 자리를 차지하지 않는다 — 데이터 컴포넌트 아래 보조 영역에만 둔다. 화면은 설명의 숫자를 다시 계산·대조하지 않는다(검증은 서버 G4~G6).
import { useState } from "react";
import type { Explanation } from "./api";
import { DISCLAIMER } from "./disclaimer";
import { Badge } from "./ui";

/** 인용 경로 표기 정규화: "deferrals[0].dueYm" → "deferrals.0.dueYm". */
const norm = (f: string) => f.replace(/\[(\d+)\]/g, ".$1").replace(/\[\*?\]/g, "").replace(/^\.+|\.+$/g, "");

/** 그 화면 요소의 경로 중 하나가 인용됐는가(같거나, 인용이 그 아래 필드거나, 그 위 객체). */
export function isCited(cited: readonly string[], ...fields: string[]): boolean {
  const cs = cited.map(norm);
  return fields.some((f) => cs.some((c) => c === f || c.startsWith(`${f}.`) || f.startsWith(`${c}.`)));
}

/** 근거 보기가 켜져 있을 때만 하이라이트 클래스. */
export function citedClass(cited: readonly string[] | null, ...fields: string[]): string | undefined {
  return cited && isCited(cited, ...fields) ? "cited" : undefined;
}

export function ExplanationBody({ e, onCite }: { e: Explanation | null; onCite?: (fields: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  if (!e || e.groundingStatus !== "PASS") {
    return (
      <div className="explain-body" data-testid="explanation">
        <Badge tone="muted">설명 없음</Badge>
        <p className="muted">{e ? "검증을 통과한 설명이 없습니다." : "이 항목의 설명은 아직 준비되지 않았습니다."}</p>
      </div>
    );
  }
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onCite?.(next ? e.citedFields : null);
  };
  return (
    <div className="explain-body" data-testid="explanation">
      <p>
        <Badge>검증 통과</Badge> <span className="muted small">{e.promptVersion}</span>
      </p>
      <p className="explain-text">{e.text}</p>
      <p className="disclaimer">{DISCLAIMER}</p>
      <button type="button" className="link-button" aria-pressed={open} onClick={toggle}>
        {open ? "근거 닫기" : "근거 보기"}
      </button>
      {open && (
        <div className="evidence" data-testid="evidence">
          <p className="muted small">위 데이터에서 노란색으로 표시한 항목이 이 설명이 인용한 값입니다.</p>
          <h4>사용된 숫자</h4>
          <ul className="chips">
            {e.numbersUsed.map((n, i) => (
              <li key={`${n}-${i}`} className="chip">
                {n}
              </li>
            ))}
          </ul>
          <h4>인용 필드</h4>
          <ul className="plain mono">
            {e.citedFields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
