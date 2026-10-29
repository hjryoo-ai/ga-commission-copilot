package com.ga.portal.projection.testing;

import com.ga.portal.domain.CommType;
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
import com.ga.portal.projection.view.ViewStore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 테넌트 하나의 인메모리 {@link ViewStore}(Phase 2 계획 ⑦). 포트가 돌려준 행 수({@link #rowsRead()} — 합계 하나는 1행)를 세어 불변식 검사 범위
 * (C11 — 기존 행 수와 무관)를 본다. 트랜잭션은 없다 — 독 이벤트 뒤의 상태는 시험이 보지 않는다(롤백은 DB 시험의 일).
 */
public final class InMemoryViewStore implements ViewStore {

    final Map<String, AgentRow> agents = new LinkedHashMap<>();
    final Map<String, LineRow> lines = new LinkedHashMap<>();
    final Map<List<String>, MonthRow> months = new LinkedHashMap<>();
    final Map<String, LedgerRow> ledgers = new LinkedHashMap<>();
    final Map<List<Object>, HistoryRow> history = new LinkedHashMap<>();
    final Map<String, DeferralRow> deferrals = new LinkedHashMap<>();
    final Map<String, ReceivableRow> receivables = new LinkedHashMap<>();
    final Map<List<Object>, FlagRow> flags = new LinkedHashMap<>();
    final Map<List<Object>, ReconRow> recon = new LinkedHashMap<>();
    private long rowsRead;

    /** 재구축의 뷰 삭제(설계서 §6.7) — 뷰 8표, {@code recon_result}는 남긴다. */
    public void clearViews() {
        agents.clear();
        lines.clear();
        months.clear();
        ledgers.clear();
        history.clear();
        deferrals.clear();
        receivables.clear();
        flags.clear();
    }

    public long rowsRead() {
        return rowsRead;
    }

    private <T> Optional<T> read(Optional<T> row) {
        rowsRead += row.isPresent() ? 1 : 0;
        return row;
    }

    @Override
    public Optional<AgentRow> agent(String agentId) {
        return read(Optional.ofNullable(agents.get(agentId)));
    }

    @Override
    public void saveAgent(AgentRow row) {
        agents.put(row.agentId(), row);
    }

    @Override
    public Optional<LineRow> line(String calcId) {
        return read(Optional.ofNullable(lines.get(calcId)));
    }

    @Override
    public void insertLine(LineRow row) {
        if (lines.putIfAbsent(row.calcId(), row) != null) {
            throw new IllegalStateException("duplicate earnings_line key");
        }
    }

    @Override
    public MonthSums monthSums(String agentId, String closeYm) {
        rowsRead++;
        long gross = 0;
        long clawback = 0;
        long adjustment = 0;
        for (LineRow l : lines.values()) {
            if (l.agentId().equals(agentId) && l.closeYm().equals(closeYm)) {
                CommType t = CommType.of(l.commType());
                if (t.isClawback()) {
                    clawback += l.amount();
                } else if (t.isAdjustment()) {
                    adjustment += l.amount();
                } else {
                    gross += l.amount();
                }
            }
        }
        return new MonthSums(gross, clawback, adjustment);
    }

    @Override
    public Optional<MonthRow> month(String agentId, String closeYm) {
        return read(Optional.ofNullable(months.get(List.of(agentId, closeYm))));
    }

    @Override
    public void saveMonth(MonthRow row) {
        months.put(List.of(row.agentId(), row.closeYm()), row);
    }

    @Override
    public Optional<LedgerRow> ledger(String ledgerId) {
        return read(Optional.ofNullable(ledgers.get(ledgerId)));
    }

    @Override
    public Optional<LedgerRow> ledgerOf(String policyNo, String agentId) {
        return read(ledgers.values().stream().filter(l -> l.policyNo().equals(policyNo) && l.agentId().equals(agentId)).findFirst());
    }

    @Override
    public void insertLedger(LedgerRow row) {
        if (ledgers.putIfAbsent(row.ledgerId(), row) != null) {
            throw new IllegalStateException("duplicate policy_limit key");
        }
    }

    @Override
    public void saveLedger(LedgerRow row) {
        if (ledgers.replace(row.ledgerId(), row) == null) {
            throw new IllegalStateException("no policy_limit row to update");
        }
    }

    @Override
    public void insertHistory(HistoryRow row) {
        if (history.putIfAbsent(List.of(row.ledgerId(), row.sourceSeq()), row) != null) {
            throw new IllegalStateException("duplicate policy_limit_history key");
        }
    }

    @Override
    public Optional<DeferralRow> deferral(String scheduleId) {
        return read(Optional.ofNullable(deferrals.get(scheduleId)));
    }

    @Override
    public void insertDeferral(DeferralRow row) {
        if (deferrals.putIfAbsent(row.scheduleId(), row) != null) {
            throw new IllegalStateException("duplicate deferral_item key");
        }
    }

    @Override
    public void saveDeferral(DeferralRow row) {
        if (deferrals.replace(row.scheduleId(), row) == null) {
            throw new IllegalStateException("no deferral_item row to update");
        }
    }

    @Override
    public Optional<ReceivableRow> receivable(String receivableId) {
        return read(Optional.ofNullable(receivables.get(receivableId)));
    }

    @Override
    public void saveReceivable(ReceivableRow row) {
        receivables.put(row.receivableId(), row);
    }

    @Override
    public List<FlagRow> flags(String policyNo, String agentId) {
        List<FlagRow> out = new ArrayList<>(flags.values().stream().filter(f -> f.policyNo().equals(policyNo) && f.agentId().equals(agentId)).toList());
        rowsRead += out.size();
        return out;
    }

    @Override
    public void saveFlag(FlagRow row) {
        flags.put(List.of(row.policyNo(), row.agentId(), row.flagType()), row);
    }

    @Override
    public void insertReconIfAbsent(ReconRow row) {
        recon.putIfAbsent(List.of(row.agentId(), row.closeYm(), row.runAt(), row.source(), row.sourceSeq()), row);
    }

    public List<AgentRow> agents() {
        return List.copyOf(agents.values());
    }

    public List<LineRow> lines() {
        return List.copyOf(lines.values());
    }

    public List<MonthRow> months() {
        return List.copyOf(months.values());
    }

    public List<LedgerRow> ledgers() {
        return List.copyOf(ledgers.values());
    }

    public List<HistoryRow> history() {
        return List.copyOf(history.values());
    }

    public List<DeferralRow> deferrals() {
        return List.copyOf(deferrals.values());
    }

    public List<ReceivableRow> receivables() {
        return List.copyOf(receivables.values());
    }

    public List<FlagRow> flagRows() {
        return List.copyOf(flags.values());
    }

    public List<ReconRow> reconRows() {
        return List.copyOf(recon.values());
    }
}
