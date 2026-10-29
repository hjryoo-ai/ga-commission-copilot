package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.projection.view.ViewStore;

import java.util.List;
import java.util.Objects;

/**
 * 뷰 프로젝터(지시문 Phase 2, 설계서 §3.4-1): 이벤트 13종을 자기 테이블로만 닫는다(계획 ② — 교차 참조는 읽기만). 금액은 계산하지 않는다 —
 * 정수 합산뿐이고 엔진 값(누적·세액·지급액)은 그대로 담는다. 순서에 기대지 않는다(D-6): 전기는 라인을 요구하지 않고 라인 상세가 calcId로 잇는다.
 * 거부는 {@link ProjectionViolation} — 적용기가 그 이벤트를 롤백하고 테넌트를 멈춘다. 대사 불일치는 거부가 아니다({@link ProjectionResult#drift()}).
 * 포털 Phase 6: 알림 파생의 입력({@link Change})을 결과에 싣는다 — 변이가 있는 이벤트 일곱(라인·전기·재산정·분급 변경·계약 이벤트·확정·지급).
 */
public final class ViewProjector implements Projector {

    private final ViewStore store;

    public ViewProjector(ViewStore store) {
        this.store = Objects.requireNonNull(store, "store");
    }

    @Override
    public ProjectionResult apply(TenantId tenant, Envelope e) {
        return switch (e.type()) {
            case "AgentSnapshot" -> {
                AgentProjector.snapshot(store, e);
                yield ProjectionResult.of(List.of("agent_profile"));
            }
            case "CommissionCalculated" -> {
                yield ProjectionResult.of(List.of("earnings_line", "earnings_month", "policy_limit"), EarningsProjector.calculated(store, e));
            }
            case "AdjustmentPosted" -> {
                EarningsProjector.adjusted(store, e);
                yield ProjectionResult.of(List.of("earnings_line", "earnings_month"));
            }
            case "LimitLedgerOpened" -> {
                LimitProjector.opened(store, e);
                yield ProjectionResult.of(List.of("policy_limit"));
            }
            case "LimitLedgerPosted" -> {
                yield ProjectionResult.of(List.of("policy_limit", "policy_limit_history"), LimitProjector.posted(store, e));
            }
            case "LimitLedgerRebased" -> {
                yield ProjectionResult.of(List.of("policy_limit", "policy_limit_history"), LimitProjector.rebased(store, e));
            }
            case "DeferralScheduled" -> {
                DeferralProjector.scheduled(store, e);
                yield ProjectionResult.of(List.of("deferral_item"));
            }
            case "DeferralStatusChanged" -> {
                yield ProjectionResult.of(List.of("deferral_item"), DeferralProjector.changed(store, e));
            }
            case "ClawbackReceivableUpdated" -> {
                ClawbackProjector.updated(store, e);
                yield ProjectionResult.of(List.of("clawback_item"));
            }
            case "PolicyEventObserved" -> {
                yield ProjectionResult.of(List.of("policy_flag"), FlagProjector.observed(store, e));
            }
            case "StatementEstimated" -> new ProjectionResult(List.of("earnings_month"), StatementProjector.estimated(store, e));
            case "StatementConfirmed" -> closed(List.of("earnings_month", "recon_result"), StatementProjector.confirmed(store, e));
            case "PayoutCompleted" -> closed(List.of("earnings_month", "recon_result"), StatementProjector.paid(store, e));
            // 수신 검증이 계약의 13종 밖을 먼저 거른다 — 여기 오면 프로젝터와 계약이 어긋난 것이다
            default -> throw new IllegalStateException("no projector for type " + e.type());
        };
    }

    private static ProjectionResult closed(List<String> tables, StatementProjector.Closed c) {
        return new ProjectionResult(tables, c.drift(), java.util.Optional.of(new Change.MonthClosed(c.after())));
    }
}
