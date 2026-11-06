import { Hono } from "hono";
import { answers } from "./api/ask";
import { budget } from "./api/budget";
import { health } from "./api/health";
import { type AppEnv, notFound, problem } from "./api/http";
import { me } from "./api/me";
import { demo } from "./api/session";
import { purgeRateLimitRows } from "./db/ScopedQuery";
import { utcDay } from "./llm/budget";

const app = new Hono<AppEnv>();

app.route("/api/v1/health", health);
app.route("/api/v1/demo", demo);
app.route("/api/v1/me", me);
app.route("/api/v1/answers", answers);
app.route("/api/v1/budget", budget);

// 없는 경로·메서드 불일치는 같은 404(상위 §7 거부·형식). 정적 자산은 run_worker_first 밖이라 여기 오지 않는다.
app.notFound((c) => notFound(c));
app.onError((err, c) => {
  console.error(err);
  return problem(c, 500, "INTERNAL_ERROR");
});

/**
 * Cron(설계서 v0.1.29 §7 — wrangler.jsonc triggers "17 0 * * *"): 전날 이전의 분 단위 레이트 리밋 행(`rl:`)을 지운다.
 * 예산·통계 카운터(global·ip·provider·stat)는 그대로 — /budget 7일 창이 읽는다.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const n = await purgeRateLimitRows(env.DB, utcDay(new Date(controller.scheduledTime)));
  console.log(`[cron] rl rows purged: ${n}`);
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
