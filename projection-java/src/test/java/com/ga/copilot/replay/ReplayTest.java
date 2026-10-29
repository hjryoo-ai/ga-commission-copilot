package com.ga.copilot.replay;

import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.GoldenViews;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * G2 리플레이(PHASES Phase 1 항목 4): 상위 골든 스트림은 통과하고 상위 골든 뷰와 같다. 한 줄 바꾼 스트림은 §5 불변식 위반으로 거부된다.
 * 생성 스트림(gen/out)의 통과는 증거 문서의 CLI 실행으로 본다(gen/out은 커밋하지 않는다).
 */
class ReplayTest {

    static List<ObjectNode> a1() {
        return Envelopes.nodes(Envelopes.a1());
    }

    static List<ObjectNode> changed(List<ObjectNode> stream, int index, Consumer<ObjectNode> payload) {
        List<ObjectNode> copy = new ArrayList<>(stream.stream().map(ObjectNode::deepCopy).toList());
        payload.accept((ObjectNode) copy.get(index).path("payload"));
        return copy;
    }

    @Test
    void theA1SampleReplaysCleanAndGivesTheUpstreamGoldenViews() {
        Replay.Result r = Replay.run(a1());
        assertThat(r.violations()).isEmpty();
        GoldenViews.assertMatches("a1", r.views());
    }

    @ParameterizedTest
    @ValueSource(strings = {"engine-e1-cycle", "engine-e2-estimate/estimate_cycle_02_채권_상계", "engine-e2-estimate/estimate_cycle_05_분급_도래"})
    void upstreamGoldenStreamsReplayClean(String stream) {
        Replay.Result r = Replay.run(Envelopes.nodes(Envelopes.stream(stream + ".jsonl")));
        assertThat(r.violations()).isEmpty();
        GoldenViews.assertMatches(stream, r.views());
    }

    @Test
    void twoReplaysGiveTheSameViewHash() {
        assertThat(Replay.run(a1()).viewsSha256()).isEqualTo(Replay.run(a1()).viewsSha256()).hasSize(64);
    }

    // ------------------------------------------------------------------ §5 불변식 1: 월 합산 = Σ 라인

    @Test
    void aConfirmationWhoseTotalsDifferFromTheLinesIsASumMismatch() {
        Replay.Result r = Replay.run(changed(a1(), 5, p -> p.put("gross", 1_799_999)));
        assertThat(r.violations()).anySatisfy(v -> assertThat(v).startsWith("SUM_MISMATCH seq 6 ").contains("A-1001 202608"));
    }

    // ------------------------------------------------------------------ §5 불변식 2: 원장

    @Test
    void aPositivePostingAboveTheLimitIsOverLimit() {
        Replay.Result r = Replay.run(changed(a1(), 4, p -> p.put("amount", 856_000).put("accumAfter", 1_801_000)));
        assertThat(r.violations()).anySatisfy(v -> assertThat(v).startsWith("OVER_LIMIT seq 5 "));
    }

    @Test
    void aBrokenAccumChainIsRejected() {
        Replay.Result r = Replay.run(changed(a1(), 4, p -> p.put("accumAfter", 1_799_000)));
        assertThat(r.violations()).anySatisfy(v -> assertThat(v).startsWith("ACCUM_CHAIN seq 5 "));
    }

    @Test
    void anAccumAboveALoweredLimitIsNormalAfterARebase() {
        // 부록 A-3: 감액 재산정 뒤 누적 > 한도는 정상(상위 §5 DD-8)
        List<ObjectNode> stream = new ArrayList<>(a1().subList(0, 5));
        stream.add((ObjectNode) Envelopes.JSON.readTree("""
                {"eventId":"5eed0000-0000-4000-8000-0000000000a3","seq":6,"type":"LimitLedgerRebased","version":1,"occurredAt":"2026-08-20T09:00:00+09:00",
                 "aggregate":{"kind":"LIMIT_LEDGER","id":"1"},"payload":{"ledgerId":"1","oldLimit":1800000,"newLimit":1200000,"monthlyPremium":100000,
                 "reason":"PREMIUM_REDUCED"}}"""));
        assertThat(Replay.run(stream).violations()).isEmpty();
    }

    // ------------------------------------------------------------------ §5 불변식 3: 마감월 불변

    @Test
    void aLineForAPaidMonthIsAClosedMonthViolation() {
        List<ObjectNode> stream = new ArrayList<>(a1().subList(0, 7));   // 202608 PAID
        ObjectNode late = a1().get(1).deepCopy();
        late.put("seq", 8).put("eventId", "5eed0000-0000-4000-8000-0000000000c4");
        ((ObjectNode) late.path("payload")).put("calcId", "99");
        ((ObjectNode) late.path("aggregate")).put("id", "99");
        stream.add(late);
        assertThat(Replay.run(stream).violations()).anySatisfy(v -> assertThat(v).startsWith("CLOSED_MONTH seq 8 "));
    }

    // ------------------------------------------------------------------ 스트림 모양

    @Test
    void aSeqGapIsReported() {
        List<ObjectNode> stream = new ArrayList<>(a1());
        stream.remove(7);   // seq 8(계약 이벤트)만 뺀다 — 뒤 이벤트는 그대로 적용된다
        assertThat(Replay.run(stream).violations()).containsExactly("SEQ_GAP seq 9 eventId 00000000-0000-0000-0000-000000000009 previous 7");
    }

    @Test
    void violationsCarryKeysOnlyNotAmounts() {
        Replay.Result r = Replay.run(changed(a1(), 5, p -> p.put("gross", 1_799_999)));
        assertThat(r.violations()).allSatisfy(v -> assertThat(v).doesNotContain("1799999").doesNotContain("1800000"));
    }

    // ------------------------------------------------------------------ CLI

    record Run(int code, JsonNode summary, String err) {
    }

    static Run cli(String... args) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        int code = ReplayCli.run(args, new PrintStream(out, true, StandardCharsets.UTF_8), new PrintStream(err, true, StandardCharsets.UTF_8));
        String o = out.toString(StandardCharsets.UTF_8);
        return new Run(code, o.isBlank() ? null : Envelopes.JSON.readTree(o), err.toString(StandardCharsets.UTF_8));
    }

    static Path write(Path dir, List<ObjectNode> stream) throws IOException {
        Path f = dir.resolve("stream.jsonl");
        Files.writeString(f, String.join("\n", stream.stream().map(JsonNode::toString).toList()) + "\n", StandardCharsets.UTF_8);
        return f;
    }

    @Test
    void cliExitsZeroWithASummaryAndWritesTheNineViewTables(@TempDir Path dir) throws IOException {
        Path views = dir.resolve("views");
        Run r = cli("replay", Envelopes.a1().toString(), "--views", views.toString());
        assertThat(r.code()).isZero();
        assertThat(r.summary().path("ok").asBoolean()).isTrue();
        assertThat(r.summary().path("events").asInt()).isEqualTo(11);
        assertThat(r.summary().path("viewsSha256").asString()).isEqualTo(r.summary().path("viewsSha256Second").asString());
        assertThat(r.summary().path("tables").path("earnings_line").asInt()).isEqualTo(3);
        for (String t : GoldenViews.TABLES) {
            assertThat(views.resolve(t + ".jsonl")).exists();
        }
        assertThat(Files.readAllLines(views.resolve("earnings_month.jsonl"))).hasSize(2);
    }

    @Test
    void cliExitsOneWithTheViolationList(@TempDir Path dir) throws IOException {
        Run r = cli("replay", write(dir, changed(a1(), 5, p -> p.put("gross", 1_799_999))).toString());
        assertThat(r.code()).isEqualTo(1);
        assertThat(r.summary().path("ok").asBoolean()).isFalse();
        assertThat(r.summary().path("violationCount").asInt()).isPositive();
        assertThat(r.summary().path("violations").get(0).asString()).startsWith("SUM_MISMATCH");
        assertThat(r.err()).contains("G2 위반").contains("SUM_MISMATCH");
    }

    @Test
    void cliExitsTwoOnUsageOrUnreadableInput(@TempDir Path dir) throws IOException {
        assertThat(cli().code()).isEqualTo(2);
        assertThat(cli("replay").code()).isEqualTo(2);
        assertThat(cli("replay", dir.resolve("missing.jsonl").toString()).code()).isEqualTo(2);
        Path junk = dir.resolve("junk.jsonl");
        Files.writeString(junk, "not json\n");
        assertThat(cli("replay", junk.toString()).code()).isEqualTo(2);
    }
}
