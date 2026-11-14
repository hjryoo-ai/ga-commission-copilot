// 화면 1~7(설계서 §8) + 라인·한도 상세. 경로는 router.tsx의 닫힌 목록.
import { match, usePath } from "./router";
import { AnswerReplayScreen } from "./screens/AnswerReplay";
import { Ask } from "./screens/Ask";
import { Budget } from "./screens/Budget";
import { EvalRun, Evals } from "./screens/Evals";
import { LimitDetail, Limits } from "./screens/Limits";
import { LineDetail } from "./screens/LineDetail";
import { SelectAgent } from "./screens/SelectAgent";
import { Statement } from "./screens/Statement";
import { Footer } from "./ui";

export function App({ path: initial }: { path?: string } = {}) {
  const live = usePath();
  const route = match(initial ?? live);
  switch (route.name) {
    case "select":
      return <SelectAgent />;
    case "statement":
      return <Statement ym={route.ym} />;
    case "line":
      return <LineDetail calcId={route.calcId} />;
    case "limits":
      return <Limits />;
    case "limit":
      return <LimitDetail ledgerId={route.ledgerId} />;
    case "ask":
      return <Ask />;
    case "budget":
      return <Budget />;
    case "evals":
      return <Evals />;
    case "evalRun":
      return <EvalRun runId={route.runId} />;
    case "answer":
      return <AnswerReplayScreen answerId={route.answerId} />;
    case "notFound":
      return (
        <>
          <main>
            <h1>찾을 수 없는 화면입니다</h1>
            <a href="/">처음으로</a>
          </main>
          <Footer />
        </>
      );
  }
}
