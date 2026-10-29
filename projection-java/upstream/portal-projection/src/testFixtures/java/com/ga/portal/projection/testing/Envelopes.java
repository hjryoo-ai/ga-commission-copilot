package com.ga.portal.projection.testing;

import com.ga.portal.projection.Envelope;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** 골든 스트림 읽기(한 줄 한 Envelope, 머리 줄 없음 — 엔진 골든 형식). 스키마 검증은 하지 않는다 — 인제스트의 일이다. */
public final class Envelopes {

    public static final JsonMapper JSON = JsonMapper.builder().build();

    private Envelopes() {
    }

    public static Path repoRoot() {
        String root = System.getProperty("ga.repoRoot");
        if (root == null) {
            throw new IllegalStateException("system property ga.repoRoot is not set (configured by the Gradle build)");
        }
        return Path.of(root);
    }

    /** 계약의 A-1 정본(v1.4 — 엔진 E2 ⓪의 둘째 판, 첫 판 10건 + 202702 잠정 명세). */
    public static Path a1() {
        return repoRoot().resolve("contracts/events/v1/samples/a1/a1_portal_150000_e2.jsonl");
    }

    /** {@code portal-projection} 시험 자원의 골든 스트림. */
    public static Path stream(String name) {
        return repoRoot().resolve("portal-projection/src/test/resources/golden-streams").resolve(name);
    }

    public static List<ObjectNode> nodes(Path file) {
        try {
            return Files.readAllLines(file, StandardCharsets.UTF_8).stream().filter(l -> !l.isBlank()).map(l -> (ObjectNode) JSON.readTree(l)).toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static List<Envelope> read(Path file) {
        return nodes(file).stream().map(Envelopes::of).toList();
    }

    public static Envelope of(ObjectNode node) {
        ObjectNode a = (ObjectNode) node.path("aggregate");
        return new Envelope(node.path("eventId").asString(), node.path("seq").asLong(), node.path("type").asString(),
                node.path("version").asInt(), node.path("occurredAt").asString(),
                new Envelope.Aggregate(a.path("kind").asString(), a.path("id").asString()), node.path("payload").deepCopy(), node.deepCopy());
    }
}
