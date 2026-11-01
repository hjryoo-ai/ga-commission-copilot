-- 설계서 v0.1.18 §5.1(운영자 2026-11-01 — 답변 VCR 방식): 로컬 녹화 전용 LLM 원문 기록. 공급자 계층이 LLM_TRACE=1(로컬 .dev.vars 전용 env)일 때만 쓴다.
-- 원격 Worker에는 LLM_TRACE가 없어 이 표는 비어 있다(아키텍처 시험: LLM_TRACE 분기 밖에서 쓰기 없음). 테넌트 열 없는 개발용 전역 표 — 설계사 데이터를 담지 않는다(요청에는 툴 결과가 들어가므로 원격에서 쓰지 않는다).
CREATE TABLE llm_trace (
  trace_id TEXT NOT NULL PRIMARY KEY,
  request_hash TEXT NOT NULL,          -- requestBody 정규 JSON의 SHA-256(카세트 키)
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request TEXT NOT NULL CHECK (json_valid(request)),
  response TEXT NOT NULL CHECK (json_valid(response)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX ix_llm_trace_hash ON llm_trace (request_hash);
