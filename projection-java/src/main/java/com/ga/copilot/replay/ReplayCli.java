package com.ga.copilot.replay;

import com.ga.portal.projection.testing.Envelopes;
import com.ga.portal.projection.testing.GoldenViews;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * {@code projection-java replay <stream.jsonl> [--views <dir>]}(PHASES Phase 1 항목 4).
 * 같은 스트림을 새 저장소로 두 번 리플레이해 뷰가 같은지도 본다(G2 "2회 리플레이 동일").
 * stdout: 요약 JSON 한 줄(gen/verify가 읽는다). stderr: 사람이 읽는 위반 목록. 종료 코드 0 통과, 1 위반, 2 사용법·입력 오류.
 * {@code --views}를 주면 표마다 {@code <dir>/<표>.jsonl}(상위 골든 뷰와 같은 정규형)을 쓴다.
 */
public final class ReplayCli {

    /** 요약 JSON에 싣는 위반 줄 수 상한(전체 수는 violationCount). */
    static final int MAX_LISTED = 200;

    private ReplayCli() {
    }

    public static void main(String[] args) {
        System.exit(run(args, System.out, System.err));
    }

    public static int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length < 2 || !args[0].equals("replay") || (args.length != 2 && !(args.length == 4 && args[2].equals("--views")))) {
            err.println("usage: replay <stream.jsonl> [--views <dir>]");
            return 2;
        }
        Path stream = Path.of(args[1]);
        Path viewsDir = args.length == 4 ? Path.of(args[3]) : null;
        byte[] bytes;
        List<ObjectNode> nodes;
        try {
            bytes = Files.readAllBytes(stream);
            nodes = Envelopes.nodes(stream);
        } catch (IOException | UncheckedIOException x) {
            err.println("cannot read stream " + stream + ": " + x.getMessage());
            return 2;
        } catch (RuntimeException x) {
            // JSON이 아니거나 줄이 객체가 아니다(ClassCastException)
            err.println("not a JSONL envelope stream " + stream + ": " + x.getMessage());
            return 2;
        }

        Replay.Result first = Replay.run(nodes);
        Replay.Result second = Replay.run(nodes);
        List<String> violations = new ArrayList<>(first.violations());
        if (!first.viewsSha256().equals(second.viewsSha256())) {
            violations.add("NONDETERMINISTIC views " + first.viewsSha256() + " != " + second.viewsSha256());
        }

        if (viewsDir != null) {
            try {
                Files.createDirectories(viewsDir);
                for (String t : GoldenViews.TABLES) {
                    List<String> rows = first.views().get(t);
                    Files.writeString(viewsDir.resolve(t + ".jsonl"), rows.isEmpty() ? "" : String.join("\n", rows) + "\n", StandardCharsets.UTF_8);
                }
            } catch (IOException x) {
                err.println("cannot write views to " + viewsDir + ": " + x.getMessage());
                return 2;
            }
        }

        ObjectNode summary = Envelopes.JSON.createObjectNode();
        summary.put("ok", violations.isEmpty());
        summary.put("stream", stream.toString());
        summary.put("streamSha256", Replay.sha256(bytes));
        summary.put("events", first.events());
        summary.put("viewsSha256", first.viewsSha256());
        summary.put("viewsSha256Second", second.viewsSha256());
        ObjectNode tables = summary.putObject("tables");
        GoldenViews.TABLES.forEach(t -> tables.put(t, first.views().get(t).size()));
        summary.put("violationCount", violations.size());
        ArrayNode listed = summary.putArray("violations");
        violations.stream().limit(MAX_LISTED).forEach(listed::add);
        out.println(summary);

        if (!violations.isEmpty()) {
            err.println("G2 위반 " + violations.size() + "건:");
            violations.forEach(v -> err.println("  " + v));
            return 1;
        }
        return 0;
    }
}
