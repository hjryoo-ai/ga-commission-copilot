package com.ga.portal.projection;

import com.ga.portal.projection.testing.Envelopes;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 골든 스트림({@code golden-streams/README.md}): 엔진 사본(A-1 둘째 판·E1 cycle·E2 잠정 명세 다섯)은 바이트 고정, A-1 변형 둘은 A-1에서 다시 만들어 대조한다. */
class GoldenStreamsTest {

    @ParameterizedTest
    @CsvSource({
            "contract,e9a03d37c513e591e7623d95bce6bc49ef2269e3c1f1336d369be2cc1eeb751a",
            "engine-e1-cycle.jsonl,407087437945683246a54f58610957919e7fc51e40cf112f819ae0164d1f64c6",
            "engine-e2-estimate/estimate_cycle_01_기본.jsonl,8dcdaff098a21ce4720268bc2a3de377570417a0bf9a476f5acd489f7c0a72c5",
            "engine-e2-estimate/estimate_cycle_02_채권_상계.jsonl,cd188a12c2dc4eb5e82863977a3623e9b7699bb552dba509cfd1ce207768d810",
            "engine-e2-estimate/estimate_cycle_03_정정_포함.jsonl,4f1d5e19928009b511976b732a15e8a2048e98f3784b78fe078cb0ad52ad72b6",
            "engine-e2-estimate/estimate_cycle_04_음수_순액_채권화.jsonl,9067d8bbac247453914ccfd3f20ca65fc28b2f3c70b7aa48c8e308f63267519f",
            "engine-e2-estimate/estimate_cycle_05_분급_도래.jsonl,049e480a3f6cd91fab67ecccebe12f673b88e0fd4bbcd231424d961e8680a9cb"})
    void engineCopiesAreByteForByte(String name, String sha256) throws IOException, NoSuchAlgorithmException {
        Path file = name.equals("contract") ? Envelopes.a1() : Envelopes.stream(name);
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)))).isEqualTo(sha256);
    }

    @Test
    void a1VariantsFollowTheirRecipes() {
        List<ObjectNode> a1 = Envelopes.nodes(Envelopes.a1());
        assertThat(a1).hasSize(11);
        assertRecipe("a1-interleaved.jsonl", pick(a1, 1, 2, 4, 3, 5, 6, 7, 8, 9, 10, 11));
        assertRecipe("a1-posted-first.jsonl", pick(a1, 1, 4, 5, 2, 3, 6, 7, 8, 10, 9, 11));
    }

    private static List<ObjectNode> pick(List<ObjectNode> a1, int... seqs) {
        List<ObjectNode> out = new ArrayList<>();
        for (int s : seqs) {
            out.add(a1.get(s - 1).deepCopy());
        }
        return out;
    }

    private static void assertRecipe(String file, List<ObjectNode> events) {
        for (int i = 0; i < events.size(); i++) {
            events.get(i).put("seq", i + 1);
        }
        assertThat(Envelopes.nodes(Envelopes.stream(file)).stream().map(ObjectNode::toString))
                .as(file).containsExactlyElementsOf(events.stream().map(ObjectNode::toString).toList());
    }
}
