package com.ga.portal.projection;

import com.ga.portal.domain.view.DeferralRow;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.domain.view.LineRow;
import com.ga.portal.domain.view.MonthRow;

import java.time.LocalDate;
import java.util.Objects;

/**
 * 프로젝터가 이 이벤트로 바꾼 것(포털 Phase 6 계획 Q4) — 알림 파생의 입력. 프로젝터가 <b>이미 읽은 행과 저장한 행</b>을 그대로 담는다(읽기 추가 0). sealed라 변이가
 * 늘면 파생 규칙의 {@code switch}가 컴파일되지 않는다(계획 승인 Q4 조건). 변이가 없는 이벤트(스냅샷·정정·개설·예약·채권·예상)는 {@link ProjectionResult#change()}가 비어 있다.
 */
public sealed interface Change {

    /** 한도 전기 — 전 = 프로젝터가 읽은 원장 행, 후 = 저장한 행(같은 한도액). */
    record LedgerPosted(LedgerRow before, LedgerRow after) implements Change {
        public LedgerPosted {
            Objects.requireNonNull(before, "before");
            Objects.requireNonNull(after, "after");
        }
    }

    /** 한도 재산정. */
    record LedgerRebased(LedgerRow before, LedgerRow after) implements Change {
        public LedgerRebased {
            Objects.requireNonNull(before, "before");
            Objects.requireNonNull(after, "after");
        }
    }

    /** 수수료 라인({@code CommissionCalculated}) — 정정 라인({@code AdjustmentPosted})은 알림이 없어 변이도 없다. */
    record LineAdded(LineRow line) implements Change {
        public LineAdded {
            Objects.requireNonNull(line, "line");
        }
    }

    /** 분급 상태 변경 — 후 = 저장한 행. */
    record DeferralChanged(DeferralRow before, DeferralRow after) implements Change {
        public DeferralChanged {
            Objects.requireNonNull(before, "before");
            Objects.requireNonNull(after, "after");
        }
    }

    /** 계약 이벤트(엔진 {@code eventType} 그대로 — {@code REINSTATE} 포함). */
    record FlagObserved(String eventType, String policyNo, String agentId, LocalDate occurredOn) implements Change {
        public FlagObserved {
            Objects.requireNonNull(eventType, "eventType");
            Objects.requireNonNull(policyNo, "policyNo");
            Objects.requireNonNull(agentId, "agentId");
            Objects.requireNonNull(occurredOn, "occurredOn");
        }
    }

    /** 명세 확정·지급 — 후 = 저장한 월 행(대사 상태 포함). */
    record MonthClosed(MonthRow after) implements Change {
        public MonthClosed {
            Objects.requireNonNull(after, "after");
        }
    }
}
