package com.ga.portal.domain;

import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;

/**
 * 인제스트 커서 상태 기계(설계서 §6.1 상태 표). 표에 없는 (상태, 사건) 조합은 거부한다 — {@link #next}가 비어 있다.
 * 재구축(Phase 2 승인 Q10): RUNNING·PAUSED·FAILED에서 운영자 {@code rebuild} → REBUILDING, 재생 성공 → RUNNING, 실패 → FAILED.
 * REBUILDING에서는 그 밖의 사건(적용·정지·pause·resume)을 받지 않는다.
 */
public final class IngestTransitions {

    private static final Map<IngestState, Map<IngestTrigger, IngestState>> TABLE = new EnumMap<>(IngestState.class);

    static {
        Map<IngestTrigger, IngestState> running = new EnumMap<>(IngestTrigger.class);
        running.put(IngestTrigger.APPLIED, IngestState.RUNNING);
        running.put(IngestTrigger.REPLAYED, IngestState.RUNNING);
        running.put(IngestTrigger.FEED_UNAVAILABLE, IngestState.RUNNING);
        running.put(IngestTrigger.STOP_FAILED, IngestState.FAILED);
        running.put(IngestTrigger.STOP_PAUSED, IngestState.PAUSED);
        running.put(IngestTrigger.OPERATOR_PAUSE, IngestState.PAUSED);
        running.put(IngestTrigger.OPERATOR_REBUILD, IngestState.REBUILDING);
        TABLE.put(IngestState.RUNNING, running);

        Map<IngestTrigger, IngestState> failed = new EnumMap<>(IngestTrigger.class);
        failed.put(IngestTrigger.OPERATOR_RESUME, IngestState.RUNNING);
        failed.put(IngestTrigger.OPERATOR_REBUILD, IngestState.REBUILDING);
        TABLE.put(IngestState.FAILED, failed);

        Map<IngestTrigger, IngestState> paused = new EnumMap<>(IngestTrigger.class);
        paused.put(IngestTrigger.OPERATOR_RESUME, IngestState.RUNNING);
        paused.put(IngestTrigger.OPERATOR_REBUILD, IngestState.REBUILDING);
        TABLE.put(IngestState.PAUSED, paused);

        Map<IngestTrigger, IngestState> rebuilding = new EnumMap<>(IngestTrigger.class);
        rebuilding.put(IngestTrigger.REBUILD_SUCCEEDED, IngestState.RUNNING);
        rebuilding.put(IngestTrigger.REBUILD_FAILED, IngestState.FAILED);
        TABLE.put(IngestState.REBUILDING, rebuilding);
    }

    private IngestTransitions() {
    }

    /** {@code from}에서 {@code trigger}가 일어난 뒤의 상태. 허용되지 않는 조합이면 비어 있다. */
    public static Optional<IngestState> next(IngestState from, IngestTrigger trigger) {
        return Optional.ofNullable(TABLE.get(from).get(trigger));
    }

    /** 워커가 폴링하는 상태인가(FAILED·PAUSED·REBUILDING은 건너뛴다). */
    public static boolean polls(IngestState state) {
        return state == IngestState.RUNNING;
    }
}
