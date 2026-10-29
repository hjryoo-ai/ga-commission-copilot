package com.ga.portal.projection;

import com.ga.platform.core.tenant.TenantId;
import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.InMemoryViewStore;
import com.ga.portal.domain.view.LineRow;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * C11(계획 ⑤ ⓐ): 적용 한 번이 포트에서 읽는 행 수는 그 테넌트의 기존 행 수와 무관하다 — 불변식 검사는 그 설계사·그 달·그 원장 범위만(전수 아님).
 * 같은 이벤트를 다른 설계사·다른 달의 라인 0개·1,000개 위에 적용해 읽기 수가 같다.
 */
class ProjectionScopeTest {

    static final TenantId T = TenantId.of("GA01");

    private static long rowsReadFor(int otherLines) {
        InMemoryViewStore store = new InMemoryViewStore();
        ViewProjector projector = new ViewProjector(store);
        List<ObjectNode> a1 = Envelopes.nodes(Envelopes.a1());
        projector.apply(T, Envelopes.of(a1.get(0)));
        String empty = "{}";
        for (int i = 0; i < otherLines; i++) {
            store.insertLine(new LineRow("other-" + i, "A-" + (2000 + i % 50), "POL-X", Optional.empty(), "FY_COMM", 1, "2026" + String.format("%02d", 1 + i % 12),
                    Optional.empty(), 0, Optional.empty(), empty, empty, 100 + i));
        }
        long before = store.rowsRead();
        for (int i = 1; i < a1.size(); i++) {
            projector.apply(T, Envelopes.of(a1.get(i)));
        }
        return store.rowsRead() - before;
    }

    @Test
    void c11RowsReadDoNotGrowWithTheTenantsHistory() {
        long small = rowsReadFor(0);
        long large = rowsReadFor(1_000);
        assertThat(large).isEqualTo(small);
        assertThat(small).as("A-1 nine events, a handful of keyed reads each").isLessThanOrEqualTo(9 * 4);
    }
}
