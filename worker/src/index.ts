import { Hono } from "hono";
import { health } from "./api/health";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/v1/health", health);

export default app;
