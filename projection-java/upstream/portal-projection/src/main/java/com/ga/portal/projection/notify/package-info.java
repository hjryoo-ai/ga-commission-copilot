/**
 * 알림 파생 규칙(설계서 §6.5 v1.9, 포털 Phase 6 계획 ③) — 순수 함수: (이벤트, 프로젝터의 {@code Change}, 임계치) → 후보. 쓰기·시각·id는 어댑터의 몫이다.
 * 문장·금액은 없다(문장은 화면 템플릿 — 계획 Q1).
 */
package com.ga.portal.projection.notify;
