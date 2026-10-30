// 의존 방향만 검사한다(설계서 v0.1.10 §3.3, CLAUDE.md 규약 2). 스타일 규칙은 두지 않는다.
// gen/world/rules/·gen/world/expand.ts는 데모 세계의 엔진 대역이라 금액을 계산한다 — 그 예외가 gen 밖으로 새지 않게
// worker·web·packages는 gen을 import할 수 없고, web은 worker 코드를 import하지 않는다(web → worker는 API로만).
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**", "gen/out/**", "projection-java/**", "data/**", "**/worker-configuration.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver({ project: ["worker/tsconfig.json", "web/tsconfig.json", "gen/tsconfig.json", "packages/*/tsconfig.json"], noWarnOnMultipleProjects: true })],
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "./worker", from: "./gen", message: "worker는 gen을 import할 수 없다 — gen/world/rules·expand는 엔진 대역(CLAUDE.md 규약 2 예외)이다." },
            { target: "./web", from: "./gen", message: "web은 gen을 import할 수 없다(CLAUDE.md 규약 2)." },
            { target: "./packages", from: "./gen", message: "packages는 gen을 import할 수 없다(CLAUDE.md 규약 2)." },
            { target: "./web", from: "./worker", message: "web → worker는 API로만(설계서 §3.3)." },
            { target: "./packages", from: "./worker", message: "packages는 gen·worker가 쓰는 쪽이다 — 역방향 금지(설계서 v0.1.14 §6.1)." },
            { target: "./packages", from: "./web", message: "packages는 gen·worker가 쓰는 쪽이다 — 역방향 금지(설계서 v0.1.14 §6.1)." },
          ],
        },
      ],
    },
  },
];
