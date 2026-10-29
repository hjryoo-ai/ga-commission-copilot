/**
 * 여러 모듈이 같이 쓰는 순수 규칙(포털 Phase 6 계획 Q12 — Phase 3·5에 {@code portal-query}·{@code portal-sim}에 두었던 것을 옮겼다): 한도 단계
 * {@link com.ga.portal.domain.rule.LimitStage}(조회 카드·알림 파생), 증권번호 가림 {@link com.ga.portal.domain.rule.PolicyMask}(조회 응답·알림 {@code params}),
 * 레이트 리밋 {@link com.ga.portal.domain.rule.RateLimitRule}(시뮬레이션 60초·문의 24시간). 형제 모듈끼리 의존하지 않게(의존 방향 규칙 (a)) 공통 하위인
 * 여기에 둔다. 정수·문자열 연산뿐이고 금액을 만들지 않는다.
 */
package com.ga.portal.domain.rule;
