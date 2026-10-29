package com.ga.copilot.replay;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/** 복사본 해시 고정(설계서 §14.1-8, upstream/UPSTREAM): upstream/의 파일 집합과 내용이 CHECKSUMS와 같다. 상위 코드를 여기서 고치면 실패한다. */
class UpstreamPinTest {

    static final Path UPSTREAM = Path.of(System.getProperty("copilot.projectionDir")).resolve("upstream");

    @Test
    void theCopiedFilesMatchTheirPinnedChecksums() throws IOException {
        Map<String, String> pinned = new TreeMap<>();
        for (String line : Files.readAllLines(UPSTREAM.resolve("CHECKSUMS"))) {
            String[] parts = line.split(" {2}", 2);
            pinned.put(parts[1], parts[0]);
        }
        Map<String, String> actual = new TreeMap<>();
        try (Stream<Path> files = Files.walk(UPSTREAM)) {
            for (Path f : files.filter(Files::isRegularFile).toList()) {
                String rel = "./" + UPSTREAM.relativize(f).toString().replace('\\', '/');
                if (!List.of("./UPSTREAM", "./CHECKSUMS").contains(rel)) {
                    actual.put(rel, Replay.sha256(Files.readAllBytes(f)));
                }
            }
        }
        assertThat(actual).hasSize(181).isEqualTo(pinned);
    }
}
