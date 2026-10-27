// gen/.dev.vars(커밋 금지 — .gitignore) 또는 프로세스 환경에서 키를 읽는다. 값은 로그에 남기지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GEN_ROOT = join(import.meta.dirname, "..");

export function loadEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = join(GEN_ROOT, ".dev.vars");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === name) return m[2]!.replace(/^["']|["']$/g, "");
  }
  return undefined;
}
