package com.ga.portal.domain.access;

import com.ga.portal.domain.Role;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * API 인가 표(조회 여덟 + 시뮬레이션 둘 — 포털 Phase 5 + 알림·문의 다섯 — Phase 6) — 엔드포인트 템플릿 → 허용 역할(정본은 {@code docs/authz-matrix.md}, {@code AuthzMatrixTest}가 이 표·문서·컨트롤러 매핑을 양방향으로 대조한다).
 * {@code /api/v1/me/**}는 전부 {@code AGENT}만(MANAGER는 v2, OPERATOR는 CLI — 지시문 D-2). 허용되지 않으면 {@link NotFound}({@code ROLE}) —
 * 응답은 다른 404와 같은 바이트.
 */
public final class ApiAuthorization {

    public static final String ME = "GET /api/v1/me";
    public static final String EARNINGS = "GET /api/v1/me/earnings";
    public static final String MONTH = "GET /api/v1/me/earnings/{ym}";
    public static final String LINES = "GET /api/v1/me/earnings/{ym}/lines";
    public static final String LINE = "GET /api/v1/me/earnings/lines/{calcId}";
    public static final String LIMITS = "GET /api/v1/me/limits";
    public static final String LIMIT = "GET /api/v1/me/limits/{ledgerId}";
    public static final String DEFERRALS = "GET /api/v1/me/deferrals";
    /** 시뮬레이션(포털 Phase 5 — 계약 1.1.0). */
    public static final String SIM_NEW_CONTRACT = "POST /api/v1/me/simulations/new-contract";
    public static final String SIM_POLICY_EVENT = "POST /api/v1/me/simulations/policy-event";
    /** 알림함·이의제기(포털 Phase 6 — 계약 1.2.0). */
    public static final String NOTIFICATIONS = "GET /api/v1/me/notifications";
    public static final String NOTIFICATION_READ = "PATCH /api/v1/me/notifications/{id}/read";
    public static final String INQUIRIES = "GET /api/v1/me/inquiries";
    public static final String INQUIRY_CREATE = "POST /api/v1/me/inquiries";
    public static final String INQUIRY = "GET /api/v1/me/inquiries/{id}";

    private static final Map<String, Set<Role>> MATRIX;

    static {
        Map<String, Set<Role>> m = new LinkedHashMap<>();
        for (String endpoint : new String[] {ME, EARNINGS, MONTH, LINES, LINE, LIMITS, LIMIT, DEFERRALS, SIM_NEW_CONTRACT, SIM_POLICY_EVENT,
                NOTIFICATIONS, NOTIFICATION_READ, INQUIRIES, INQUIRY_CREATE, INQUIRY}) {
            m.put(endpoint, Set.of(Role.AGENT));
        }
        MATRIX = Collections.unmodifiableMap(m);
    }

    private ApiAuthorization() {
    }

    /** 엔드포인트 → 허용 역할(선언 순서). */
    public static Map<String, Set<Role>> matrix() {
        return MATRIX;
    }

    public static void require(Caller caller, String endpoint) {
        Set<Role> allowed = MATRIX.get(endpoint);
        if (allowed == null) {
            throw new IllegalStateException("endpoint not in the authorization matrix: " + endpoint);
        }
        if (!allowed.contains(caller.role())) {
            throw new NotFound(DenyReason.ROLE);
        }
    }
}
