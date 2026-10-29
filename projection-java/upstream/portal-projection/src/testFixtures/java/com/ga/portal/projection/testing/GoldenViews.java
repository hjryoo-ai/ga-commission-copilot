package com.ga.portal.projection.testing;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 골든 뷰(Phase 2 계획 ⑨): 표마다 {@code golden-views/<스트림>/<표>.jsonl} — 한 줄 한 행, 열 이름은 DB 열 그대로(snake_case, {@code tenant_id} 제외),
 * 키 정렬·공백 없는 JSON, 줄은 사전순. 시각은 UTC ISO-8601({@link Instant#toString()}), 날짜는 {@code yyyy-MM-dd}, 비어 있으면 {@code null},
 * JSONB는 객체 그대로. 인메모리 저장소({@link #of(InMemoryViewStore)})와 DB(ProjectionGoldenIT)가 같은 정규형을 낸다.
 */
public final class GoldenViews {

    /** 대조하는 표(뷰 9개 — 지시문 D-12). 빈 표도 파일이 있어야 한다. */
    public static final List<String> TABLES = List.of("agent_profile", "earnings_line", "earnings_month", "policy_limit", "policy_limit_history",
            "deferral_item", "clawback_item", "policy_flag", "recon_result");

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private GoldenViews() {
    }

    public static Path dir(String stream) {
        return Envelopes.repoRoot().resolve("portal-projection/src/test/resources/golden-views").resolve(stream);
    }

    /** 표 → 정규형 줄(사전순). */
    public static Map<String, List<String>> of(InMemoryViewStore s) {
        Map<String, List<ObjectNode>> rows = new LinkedHashMap<>();
        rows.put("agent_profile", map(s.agents(), r -> obj("agent_id", r.agentId(), "name", r.name(), "grade", r.grade(), "org_path", r.orgPath(),
                "role", r.role(), "status", r.status().name(), "valid_from", r.validFrom(), "last_seq", r.lastSeq())));
        rows.put("earnings_line", map(s.lines(), r -> obj("calc_id", r.calcId(), "agent_id", r.agentId(), "policy_no", r.policyNo(),
                "product_key", r.productKey(), "comm_type", r.commType(), "amount", r.amount(), "close_ym", r.closeYm(),
                "reversal_of_calc_id", r.reversalOfCalcId(), "limit_cut_amt", r.limitCutAmt(), "limit_cut_policy", r.limitCutPolicy(),
                "basis", Envelopes.JSON.readTree(r.basis()), "policy_summary", Envelopes.JSON.readTree(r.policySummary()),
                "source_seq", r.sourceSeq())));
        rows.put("earnings_month", map(s.months(), r -> obj("agent_id", r.agentId(), "close_ym", r.closeYm(), "gross", r.gross(),
                "clawback_offset", r.clawbackOffset(), "adjustment", r.adjustment(), "withholding_tax", r.withholdingTax(), "net", r.net(),
                "status", r.status().name(), "data_status", r.dataStatus().name(), "estimate_as_of", r.estimateAsOf(),
                "estimate_basis_seq", r.estimateBasisSeq(), "confirmed_at", r.confirmedAt(), "paid_at", r.paidAt(), "paid_amount", r.paidAmount(),
                "receivable_offset", r.receivableOffset(), "carried_receivable", r.carriedReceivable(), "payable", r.payable(),
                "run_seq", r.runSeq(), "net_basis", r.netBasis().map(Enum::name), "last_seq", r.lastSeq())));
        rows.put("policy_limit", map(s.ledgers(), r -> obj("ledger_id", r.ledgerId(), "agent_id", r.agentId(), "policy_no", r.policyNo(),
                "contract_date", r.contractDate(), "fy_start", r.fyStart(), "fy_end", r.fyEnd(), "monthly_premium", r.monthlyPremium(),
                "limit_multiple", r.limitMultiple(), "limit_amount", r.limitAmount(), "accum_paid", r.accumPaid(), "cut_total", r.cutTotal(),
                "deferred_total", r.deferredTotal(), "last_posting_seq", r.lastPostingSeq(), "rule_version_id", r.ruleVersionId())));
        rows.put("policy_limit_history", map(s.history(), r -> obj("ledger_id", r.ledgerId(), "source_seq", r.sourceSeq(),
                "posting_seq", r.postingSeq(), "kind", r.kind(), "calc_id", r.calcId(), "amount", r.amount(), "accum_after", r.accumAfter(),
                "limit_after", r.limitAfter(), "reason", r.reason(), "occurred_at", r.occurredAt())));
        rows.put("deferral_item", map(s.deferrals(), r -> obj("schedule_id", r.scheduleId(), "agent_id", r.agentId(), "policy_no", r.policyNo(),
                "source_calc_id", r.sourceCalcId(), "due_ym", r.dueYm(), "amount", r.amount(), "pay_condition", r.payCondition(),
                "status", r.status().name(), "reason", r.reason(), "curve_version_id", r.curveVersionId(), "status_reason", r.statusReason(),
                "last_seq", r.lastSeq())));
        rows.put("clawback_item", map(s.receivables(), r -> obj("receivable_id", r.receivableId(), "agent_id", r.agentId(),
                "origin_calc_id", r.originCalcId(), "amount", r.amount(), "remaining", r.remaining(), "status", r.status().name(),
                "last_seq", r.lastSeq())));
        rows.put("policy_flag", map(s.flagRows(), r -> obj("policy_no", r.policyNo(), "agent_id", r.agentId(), "flag_type", r.flagType().name(),
                "occurred_on", r.occurredOn(), "cleared_at", r.clearedAt(), "reason", r.reason())));
        rows.put("recon_result", map(s.reconRows(), r -> obj("agent_id", r.agentId(), "close_ym", r.closeYm(), "run_at", r.runAt(),
                "portal_gross", r.portalGross(), "portal_offset", r.portalOffset(), "portal_adjustment", r.portalAdjustment(),
                "engine_gross", r.engineGross(), "engine_offset", r.engineOffset(), "engine_adjustment", r.engineAdjustment(),
                "engine_net", r.engineNet(), "status", r.status(), "source", r.source().name(), "source_seq", r.sourceSeq())));
        Map<String, List<String>> out = new LinkedHashMap<>();
        rows.forEach((t, list) -> out.put(t, lines(list)));
        return out;
    }

    /** 정규형 줄(사전순). */
    public static List<String> lines(List<ObjectNode> rows) {
        List<String> out = new ArrayList<>(rows.stream().map(GoldenViews::canonical).toList());
        out.sort(String::compareTo);
        return out;
    }

    /** 키 정렬·공백 없는 JSON. */
    public static String canonical(JsonNode node) {
        return sort(node).toString();
    }

    private static JsonNode sort(JsonNode node) {
        if (node.isObject()) {
            TreeMap<String, JsonNode> sorted = new TreeMap<>();
            node.properties().forEach(e -> sorted.put(e.getKey(), sort(e.getValue())));
            ObjectNode o = F.objectNode();
            sorted.forEach(o::set);
            return o;
        }
        if (node.isArray()) {
            var a = F.arrayNode();
            node.forEach(c -> a.add(sort(c)));
            return a;
        }
        if (node.isIntegralNumber()) {
            return F.numberNode(node.asLong());   // int·long·BigInteger 노드를 같게
        }
        return node;
    }

    /** 기대 파일과 대조한다. {@code -Pgolden.update=true}이면 대신 쓴다(쓴 뒤에는 사람이 손계산과 대조한다). */
    public static void assertMatches(String stream, Map<String, List<String>> actual) {
        Path dir = dir(stream);
        boolean update = Boolean.parseBoolean(System.getProperty("golden.update", "false"));
        assertThat(actual.keySet()).containsExactlyElementsOf(TABLES);
        for (String table : TABLES) {
            Path file = dir.resolve(table + ".jsonl");
            try {
                if (update) {
                    Files.createDirectories(dir);
                    Files.write(file, actual.get(table), StandardCharsets.UTF_8);
                    continue;
                }
                assertThat(file).as("golden view %s/%s", stream, table).exists();
                List<String> expected = Files.readAllLines(file, StandardCharsets.UTF_8).stream().filter(l -> !l.isBlank())
                        .map(l -> canonical(Envelopes.JSON.readTree(l))).sorted().toList();
                assertThat(actual.get(table)).as("%s/%s", stream, table).containsExactlyElementsOf(expected);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    /** 이벤트 seq 열({@code source_seq}·{@code last_seq}·{@code estimate_basis_seq})을 뺀 투영 — 순서 변형 대조(C3). 원장 순번은 순서와 무관해 남긴다. */
    public static Map<String, List<String>> withoutSeqs(Map<String, List<String>> tables) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        tables.forEach((t, lines) -> {
            List<ObjectNode> rows = new ArrayList<>();
            for (String l : lines) {
                ObjectNode o = (ObjectNode) Envelopes.JSON.readTree(l);
                o.remove(List.of("source_seq", "last_seq", "estimate_basis_seq"));
                rows.add(o);
            }
            out.put(t, lines(rows));
        });
        return out;
    }

    private static <T> List<ObjectNode> map(List<T> rows, Function<T, ObjectNode> f) {
        return rows.stream().map(f).toList();
    }

    private static ObjectNode obj(Object... kv) {
        ObjectNode o = F.objectNode();
        for (int i = 0; i < kv.length; i += 2) {
            o.set((String) kv[i], value(kv[i + 1]));
        }
        return o;
    }

    private static JsonNode value(Object v) {
        return switch (v) {
            case null -> F.nullNode();
            case Optional<?> opt -> opt.map(GoldenViews::value).orElse(F.nullNode());
            case String s -> F.stringNode(s);
            case Long l -> F.numberNode(l);
            case Integer i -> F.numberNode((long) i);
            case Instant t -> F.stringNode(t.toString());
            case LocalDate d -> F.stringNode(d.toString());
            case JsonNode n -> n;
            default -> throw new IllegalArgumentException("no golden form for " + v.getClass().getSimpleName());
        };
    }
}
