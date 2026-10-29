/**
 * 읽기 모델 뷰 표의 행(설계서 §5 v1.5 — 컬럼 이름 그대로). 행은 값만 담고 판정은 {@code portal-projection}의 프로젝터가, 저장은 그 포트
 * {@code ViewStore}의 어댑터({@code portal-app} → {@code portal-infra} 저장소)가 한다 — 두 모듈이 같이 보는 타입이라 여기 둔다(Phase 1의
 * {@code CursorRecord}·{@code IngestEventRecord}와 같은 이유). 시각은 {@link java.time.Instant}, 날짜는 {@link java.time.LocalDate}, 금액은
 * 정수 원(long), JSONB는 JSON 텍스트(엔진 원문 — 도메인은 JSON 라이브러리를 보지 않는다), 엔진의 소수(배수)는 불투명 문자열이다.
 *
 * <p>포털 Phase 3: 조회 API가 읽는 모양({@code LineItem}·{@code LineDetail}·{@code LinePage}·{@code LedgerItem}·{@code DueMonth}·
 * {@code SyncSnapshot})도 여기 둔다 — {@code portal-query}의 포트와 {@code portal-infra}의 조회 저장소가 같이 보는 타입이다(infra는 query를 볼 수 없다).
 * 조회용 JSONB 필드는 SQL이 꺼낸 문자열·정수다.
 */
package com.ga.portal.domain.view;
