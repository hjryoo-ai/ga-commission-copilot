package com.ga.copilot.replay;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.domain.MonthStatus;
import com.ga.portal.domain.view.HistoryRow;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.domain.view.LineRow;
import com.ga.portal.domain.view.MonthRow;
import com.ga.portal.domain.view.MonthSums;
import com.ga.portal.projection.Envelope;
import com.ga.portal.projection.ProjectionResult;
import com.ga.portal.projection.ProjectionViolation;
import com.ga.portal.projection.ViewProjector;
import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.GoldenViews;
import com.ga.portal.projection.testing.InMemoryViewStore;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * G2 리플레이(설계서 §4.2): 스트림 전체를 상위 {@link ViewProjector}로 인메모리 뷰에 적용하고 상위 설계서 §5 불변식 세 가지를 본다.
 * <ol>
 *   <li>월 합산 = Σ 라인 — 확정·지급 이벤트의 합계가 포털 합산과 다르면(상위의 대사 불일치 DRIFT) 위반. 끝 상태의 월 행도 다시 합산해 대조한다.</li>
 *   <li>원장 — 순번 +1, 누적 사슬, 양수 전기 뒤 누적 ≤ 한도, 누적 ≥ 0(상위 프로젝터가 거부). 끝 상태에서 누적 &gt; 한도는 감액 재산정 뒤일 때만 허용(부록 A-3).</li>
 *   <li>마감월 불변 — 확정·지급된 달의 라인·정정·예상·재확정은 상위 프로젝터가 거부. 끝 상태에서 확정 뒤에 들어온 그 달 라인이 없는지 다시 본다.</li>
 * </ol>
 * 위반 이벤트는 건너뛰고 끝까지 간다(목록을 다 모은다). 앞 위반 때문에 생긴 뒤 위반도 섞일 수 있다. 위반 문구에는 키만 쓴다(상위 규약 — 금액 없음).
 */
public final class Replay {

    /** 데모 세계 테넌트(gen/world/rules/tables.ts TENANT). */
    public static final TenantId TENANT = TenantId.of("T1");

    private Replay() {
    }

    /**
     * @param events     적용한 이벤트 수
     * @param views      표 → 정규형 줄(상위 {@link GoldenViews} — 키 정렬·사전순)
     * @param violations 위반 목록(비면 통과)
     */
    public record Result(int events, Map<String, List<String>> views, List<String> violations) {

        public Result {
            views = Collections.unmodifiableMap(new LinkedHashMap<>(views));   // 표 순서(GoldenViews.TABLES) 유지
            violations = List.copyOf(violations);
        }

        public boolean ok() {
            return violations.isEmpty();
        }

        /** 표 순서({@link GoldenViews#TABLES})대로 "표 이름 줄 + 행 줄들"을 이은 바이트의 SHA-256. */
        public String viewsSha256() {
            StringBuilder b = new StringBuilder();
            for (String t : GoldenViews.TABLES) {
                b.append(t).append('\n');
                views.get(t).forEach(l -> b.append(l).append('\n'));
            }
            return sha256(b.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    public static Result run(List<ObjectNode> nodes) {
        InMemoryViewStore store = new InMemoryViewStore();
        ViewProjector projector = new ViewProjector(store);
        List<String> violations = new ArrayList<>();
        Map<List<String>, Long> confirmedSeq = new LinkedHashMap<>();
        long prevSeq = 0;
        for (ObjectNode node : nodes) {
            Envelope e;
            try {
                e = Envelopes.of(node);
            } catch (RuntimeException x) {
                // 봉투 모양 검사는 G1의 일 — 여기서는 멈추지 않고 위반으로 남긴다
                violations.add("PROJECTOR_ERROR seq " + node.path("seq").asString() + " not an envelope: " + x.getClass().getSimpleName());
                continue;
            }
            if (e.seq() != prevSeq + 1) {
                violations.add("SEQ_GAP " + keys(e) + " previous " + prevSeq);
            }
            prevSeq = e.seq();
            try {
                ProjectionResult r = projector.apply(TENANT, e);
                if (r.drift()) {
                    violations.add("SUM_MISMATCH " + keys(e) + " " + e.type() + " " + month(e));
                }
            } catch (ProjectionViolation v) {
                violations.add(v.getMessage() + " (" + e.type() + ")");
                continue;
            } catch (RuntimeException x) {
                violations.add("PROJECTOR_ERROR " + keys(e) + " " + e.type() + " " + x.getClass().getSimpleName() + ": " + x.getMessage());
                continue;
            }
            if (e.type().equals("StatementConfirmed")) {
                confirmedSeq.putIfAbsent(List.of(e.payload().path("agentId").asString(), e.payload().path("closeYm").asString()), e.seq());
            }
        }
        violations.addAll(finalState(store, confirmedSeq));
        return new Result(nodes.size(), GoldenViews.of(store), violations);
    }

    /** 끝 상태 대조 — 상위 프로젝터가 이벤트마다 거부한 것을 뷰 전체에서 한 번 더 본다. */
    static List<String> finalState(InMemoryViewStore store, Map<List<String>, Long> confirmedSeq) {
        List<String> out = new ArrayList<>();
        for (MonthRow m : store.months()) {
            MonthSums s = store.monthSums(m.agentId(), m.closeYm());
            if (s.gross() != m.gross() || s.clawbackOffset() != m.clawbackOffset() || s.adjustment() != m.adjustment()) {
                out.add("SUM_MISMATCH earnings_month " + m.agentId() + " " + m.closeYm());
            }
            if ((m.status() == MonthStatus.CONFIRMED || m.status() == MonthStatus.PAID) && !confirmedSeq.containsKey(List.of(m.agentId(), m.closeYm()))) {
                out.add("STATE_MISMATCH earnings_month " + m.agentId() + " " + m.closeYm() + " closed without StatementConfirmed");
            }
        }
        List<HistoryRow> history = store.history();
        for (LedgerRow l : store.ledgers()) {
            if (l.accumPaid() < 0) {
                out.add("NEGATIVE_ACCUM policy_limit " + l.ledgerId());
            }
            boolean rebasedDown = history.stream()
                    .anyMatch(h -> h.ledgerId().equals(l.ledgerId()) && h.kind().equals("REBASE") && h.limitAfter() == l.limitAmount());
            if (l.accumPaid() > l.limitAmount() && !rebasedDown) {
                out.add("OVER_LIMIT policy_limit " + l.ledgerId());
            }
        }
        for (LineRow line : store.lines()) {
            Long closed = confirmedSeq.get(List.of(line.agentId(), line.closeYm()));
            if (closed != null && line.sourceSeq() > closed) {
                out.add("CLOSED_MONTH earnings_line " + line.calcId() + " seq " + line.sourceSeq());
            }
        }
        return out;
    }

    static String keys(Envelope e) {
        return "seq " + e.seq() + " eventId " + e.eventId();
    }

    private static String month(Envelope e) {
        return e.payload().path("agentId").asString() + " " + e.payload().path("closeYm").asString();
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException x) {
            throw new IllegalStateException(x);
        }
    }
}
