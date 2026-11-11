# schema_hint

Workers AI 폴백(`@cf/openai/gpt-oss-120b`, AI 바인딩)에만 붙이는 system 메시지 — 설계서 v0.1.35 §6.2. 답변 프롬프트(`prompts/answer/*`) 앞에 놓고 본문은 바꾸지 않는다.

## v1 (2026-11-11)

- 최초 작성. Workers AI는 `response_format` json_schema를 강제하지 않는다(2026-11-11 실측 — 네이티브 `/ai/run`·OpenAI 호환 `/ai/v1/chat/completions` 모두, 짧은 스키마는 따르지만 answer/v3 실제 요청(약 6.4K자)에서는 `reason`·`numbersUsed` 빠짐·`args` 대신 `arguments` → G1 SHAPE). 같은 요청에 이 문구 + 스키마를 system으로 붙이면 6키·`args` 모양 그대로(같은 날 REST 대조 3변형).
- 문구는 실측한 영어 그대로(바꾸면 다시 잰다). `{{schema}}` = 요청의 출력 스키마 JSON.
