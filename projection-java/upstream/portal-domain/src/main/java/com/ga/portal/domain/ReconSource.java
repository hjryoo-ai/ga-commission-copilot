package com.ga.portal.domain;

/** 대사 결과의 출처(설계서 §5 {@code recon_result.source}, §6.6). */
public enum ReconSource {
    /** 마감·지급 이벤트의 합계와 포털 합산의 대조(Phase 2 지시문 D-3 — 대사의 첫 지점). {@code source_seq} = 그 이벤트의 seq. */
    EVENT,
    /** 야간 대사 배치(Phase 7). {@code source_seq} = 0. */
    BATCH
}
