package com.ga.portal.projection.view;

import com.ga.portal.domain.view.AgentRow;
import com.ga.portal.domain.view.DeferralRow;
import com.ga.portal.domain.view.FlagRow;
import com.ga.portal.domain.view.HistoryRow;
import com.ga.portal.domain.view.LedgerRow;
import com.ga.portal.domain.view.LineRow;
import com.ga.portal.domain.view.MonthRow;
import com.ga.portal.domain.view.MonthSums;
import com.ga.portal.domain.view.ReceivableRow;
import com.ga.portal.domain.view.ReconRow;

import java.util.List;
import java.util.Optional;

/**
 * 뷰 저장 포트(설계서 §5). 모든 메서드는 인제스트 적용기가 연 그 이벤트의 트랜잭션 안에서, 바인딩된 테넌트에 대해 불린다 — 테넌트 인자가 없다
 * ({@code IngestStore}와 같은 규약). 읽기는 키 하나·합계 하나 단위다(불변식 검사 범위 — 지시문 D-13, 계획 ⑤). 구현: {@code portal-app}의
 * 어댑터(인프라 저장소 위임), 시험 픽스처의 인메모리.
 */
public interface ViewStore {

    Optional<AgentRow> agent(String agentId);

    /** upsert. */
    void saveAgent(AgentRow row);

    Optional<LineRow> line(String calcId);

    /** 새 행만(같은 키가 있으면 구현이 예외 — 프로젝터가 먼저 {@link #line}로 거른다). */
    void insertLine(LineRow row);

    /** 그 설계사·그 달 라인의 합(집계 한 번). 라인이 없으면 {@link MonthSums#ZERO}. */
    MonthSums monthSums(String agentId, String closeYm);

    Optional<MonthRow> month(String agentId, String closeYm);

    /** upsert. */
    void saveMonth(MonthRow row);

    Optional<LedgerRow> ledger(String ledgerId);

    Optional<LedgerRow> ledgerOf(String policyNo, String agentId);

    void insertLedger(LedgerRow row);

    /** 있는 행 갱신. */
    void saveLedger(LedgerRow row);

    void insertHistory(HistoryRow row);

    Optional<DeferralRow> deferral(String scheduleId);

    void insertDeferral(DeferralRow row);

    /** 있는 행 갱신. */
    void saveDeferral(DeferralRow row);

    Optional<ReceivableRow> receivable(String receivableId);

    /** upsert. */
    void saveReceivable(ReceivableRow row);

    /** 그 계약·그 설계사의 플래그 전부(최대 4 — 플래그 유형 수). */
    List<FlagRow> flags(String policyNo, String agentId);

    /** upsert(키 {@code (policy_no, agent_id, flag_type)}). */
    void saveFlag(FlagRow row);

    /** 같은 키가 없을 때만 넣는다. */
    void insertReconIfAbsent(ReconRow row);
}
