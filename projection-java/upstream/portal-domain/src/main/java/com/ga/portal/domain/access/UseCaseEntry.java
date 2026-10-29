package com.ga.portal.domain.access;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 조회 유스케이스의 진입점(계획 승인 Q8 — ga-disclosure와 같게 표식은 유스케이스 메서드에). 값은 엔드포인트 템플릿({@code "GET /api/v1/me"} 꼴)이고
 * {@link ApiAuthorization}의 키와 같다. 진입점은 본문 첫 줄에서 {@link ApiAuthorization#require}로 역할을 확인한다. 컨트롤러는 이 표식이 있는 메서드를
 * 정확히 하나 부른다(아키텍처 규칙).
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface UseCaseEntry {

    String value();
}
