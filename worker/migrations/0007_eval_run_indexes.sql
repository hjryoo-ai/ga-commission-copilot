-- 0007 eval_run 조회 인덱스(PHASES Phase 6 항목 5 — GET /api/v1/evals, 설계서 §5.3 풀스캔 금지).
-- 목록: ORDER BY started_at DESC, run_id DESC LIMIT n. 분산(n=3): trigger 'variance:' 접두 구간 + started_at 내림차순.
-- eval_case_result는 PK (run_id, case_id)가 run_id IN (…)을 덮는다. 전역 표(tenant 열 없음 — 운영 평가 기록).
CREATE INDEX ix_eval_run_started ON eval_run (started_at, run_id);
CREATE INDEX ix_eval_run_trigger ON eval_run (trigger, started_at);
