package com.ga.portal.projection.notify;

import com.ga.portal.domain.CommType;
import com.ga.portal.domain.DataStatus;
import com.ga.portal.domain.DeferralStatus;
import com.ga.portal.domain.NotificationType;
import com.ga.portal.domain.notify.NotificationParams;
import com.ga.portal.domain.rule.LimitStage;
import com.ga.portal.domain.rule.PolicyMask;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.domain.view.LineRow;
import com.ga.portal.projection.Change;
import com.ga.portal.projection.Envelope;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * 알림 파생 규칙 — 설계서 §6.5 표(v1.9, 계획 ③) 그대로. "후"는 이 이벤트를 적용한 뒤의 행이다.
 * <ul>
 *   <li>전기: 단계(후) &gt; 단계(전)이면 <b>후 단계 하나</b>(두 경계를 한 번에 넘어도 1건 — Q2), 키 {@code LIMIT_{단계}:{원장}:{seq}}(하향 뒤 재상향은 새 키).
 *       같은 한도액·같은 임계치로 전후를 잰다.</li>
 *   <li>재산정: 늘 {@code LIMIT_REBASE:{원장}:{seq}} 하나(한도가 줄어 단계가 올라도 이것뿐).</li>
 *   <li>라인: 삭감 &gt; 0이면 {@code LIMIT_CUT:{calcId}}, 환수 라인이면 {@code CLAWBACK:{calcId}} — 둘 다일 수 있다(각각 따로 중복 판정).</li>
 *   <li>분급: 도착 상태가 보류·취소면 {@code DEFER_{상태}:{scheduleId}}(각 상태는 한 항목에 한 번만 온다 — {@code DeferralTransitions}).</li>
 *   <li>계약 이벤트: 납입 지연·실효·해약이면 {@code POLICY_{유형}:{eventId}}, 링크 없음({@code REINSTATE}는 0).</li>
 *   <li>확정·지급: 후 달이 {@code DRIFT}가 아닐 때만 {@code STMT_CONFIRMED:{ym}}·{@code PAYOUT:{ym}}(Q17 — 맞지 않는 숫자를 "확정"으로 부르지 않는다).</li>
 * </ul>
 * 수신자는 행의 설계사다(원장·분급 이벤트에는 {@code agentId}가 없다 — 행의 {@code agent_id}도 엔진 사실이다, P-1). 임계치는 전기일 때만 읽는다.
 */
public final class NotificationRules {

    private NotificationRules() {
    }

    public static List<Candidate> candidates(Envelope e, Change change, Supplier<Thresholds> thresholds) {
        return switch (change) {
            case Change.LedgerPosted c -> posted(e, c, thresholds.get());
            case Change.LedgerRebased c -> List.of(new Candidate(c.after().agentId(), NotificationType.LIMIT_REBASE,
                    "LIMIT_REBASE:" + c.after().ledgerId() + ":" + e.seq(), ledger(c.after())));
            case Change.LineAdded c -> line(c.line());
            case Change.DeferralChanged c -> switch (c.after().status()) {
                case HELD, CANCELLED -> List.of(new Candidate(c.after().agentId(), deferral(c.after().status()),
                        "DEFER_" + c.after().status().name() + ":" + c.after().scheduleId(),
                        new NotificationParams.Deferral(c.after().sourceCalcId(), PolicyMask.mask(c.after().policyNo()), c.after().dueYm())));
                case SCHEDULED, RELEASED -> List.of();
            };
            case Change.FlagObserved c -> switch (c.eventType()) {
                case "PAYMENT_OVERDUE", "LAPSE", "CANCEL" -> List.of(new Candidate(c.agentId(), NotificationType.valueOf("POLICY_" + c.eventType()),
                        "POLICY_" + c.eventType() + ":" + e.eventId(), new NotificationParams.Policy(PolicyMask.mask(c.policyNo()), c.occurredOn())));
                default -> List.of();
            };
            case Change.MonthClosed c -> {
                if (c.after().dataStatus() == DataStatus.DRIFT) {
                    yield List.of();
                }
                NotificationType type = switch (e.type()) {
                    case "StatementConfirmed" -> NotificationType.STMT_CONFIRMED;
                    case "PayoutCompleted" -> NotificationType.PAYOUT;
                    default -> throw new IllegalStateException("a closed month from " + e.type());
                };
                yield List.of(new Candidate(c.after().agentId(), type, type.name() + ":" + c.after().closeYm(),
                        new NotificationParams.Month(c.after().closeYm())));
            }
        };
    }

    /** 표의 마지막 줄 — 운영 CLI {@code inquiry answer}({@code OPEN → ANSWERED})가 같은 트랜잭션에서 넣는다. 수신자는 문의 행의 설계사. */
    public static Candidate inquiryAnswered(String agentId, String inquiryId) {
        return new Candidate(agentId, NotificationType.INQUIRY_ANSWERED, "INQUIRY:" + inquiryId, new NotificationParams.Inquiry(inquiryId));
    }

    private static List<Candidate> posted(Envelope e, Change.LedgerPosted c, Thresholds t) {
        LimitStage before = stage(c.before(), t);
        LimitStage after = stage(c.after(), t);
        if (after.compareTo(before) <= 0) {
            return List.of();
        }
        NotificationType type = switch (after) {
            case WARN -> NotificationType.LIMIT_WARN;
            case CRIT -> NotificationType.LIMIT_CRIT;
            case FULL -> NotificationType.LIMIT_FULL;
            case OK -> throw new IllegalStateException("OK is never above another stage");
        };
        return List.of(new Candidate(c.after().agentId(), type, type.name() + ":" + c.after().ledgerId() + ":" + e.seq(), ledger(c.after())));
    }

    /** 조회 카드와 같은 판정 — 남은 한도 = 한도 − 누적(정수 차감). */
    static LimitStage stage(LedgerRow r, Thresholds t) {
        return LimitStage.of(r.accumPaid(), r.limitAmount(), Math.subtractExact(r.limitAmount(), r.accumPaid()), t.warnBp(), t.critBp());
    }

    private static NotificationParams.Ledger ledger(LedgerRow r) {
        return new NotificationParams.Ledger(r.ledgerId(), PolicyMask.mask(r.policyNo()));
    }

    private static List<Candidate> line(LineRow l) {
        List<Candidate> out = new ArrayList<>(2);
        NotificationParams.Line params = new NotificationParams.Line(l.calcId(), PolicyMask.mask(l.policyNo()), l.closeYm());
        if (l.limitCutAmt() > 0) {
            out.add(new Candidate(l.agentId(), NotificationType.LIMIT_CUT, "LIMIT_CUT:" + l.calcId(), params));
        }
        if (CommType.of(l.commType()).isClawback()) {
            out.add(new Candidate(l.agentId(), NotificationType.CLAWBACK, "CLAWBACK:" + l.calcId(), params));
        }
        return List.copyOf(out);
    }

    private static NotificationType deferral(DeferralStatus to) {
        return to == DeferralStatus.HELD ? NotificationType.DEFER_HELD : NotificationType.DEFER_CANCELLED;
    }
}
