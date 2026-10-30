import { Hono } from "hono";
import { health } from "./api/health";
import { type AppEnv, notFound, problem } from "./api/http";
import { me } from "./api/me";
import { demo } from "./api/session";

const app = new Hono<AppEnv>();

app.route("/api/v1/health", health);
app.route("/api/v1/demo", demo);
app.route("/api/v1/me", me);

// 없는 경로·메서드 불일치는 같은 404(상위 §7 거부·형식). 정적 자산은 run_worker_first 밖이라 여기 오지 않는다.
app.notFound((c) => notFound(c));
app.onError((err, c) => {
  console.error(err);
  return problem(c, 500, "INTERNAL_ERROR");
});

export default app;
