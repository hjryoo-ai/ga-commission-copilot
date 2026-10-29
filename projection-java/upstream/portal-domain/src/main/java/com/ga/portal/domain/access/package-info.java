/**
 * API 접근 규약(포털 Phase 5 계획 Q11 — Phase 3에 {@code portal-query}에 두었던 것을 옮겼다): 호출자 {@link com.ga.portal.domain.access.Caller}, 진입점 표식
 * {@link com.ga.portal.domain.access.UseCaseEntry}, 인가 표 {@link com.ga.portal.domain.access.ApiAuthorization}, 거부 {@link com.ga.portal.domain.access.NotFound}·
 * {@link com.ga.portal.domain.access.InvalidRequest}. 조회({@code portal-query})와 시뮬레이션({@code portal-sim})이 같은 표·같은 표식을 쓴다 — 형제 모듈끼리
 * 의존하지 않게(의존 방향 규칙 (a)) 둘의 공통 하위인 여기에 둔다. Spring·DB 무의존 값뿐이다.
 */
package com.ga.portal.domain.access;
