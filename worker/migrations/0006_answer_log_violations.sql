-- 설계서 v0.1.25 §5.1(운영자 2026-11-05 — DECISIONS 화면 7 검증 실패 토큰 (2)): 답변 검증 위반 목록.
-- JSON {g4Missing[], g5Unknown[], g6Words[]} — 거부·PASS 모두 쓴다(위반 없으면 빈 배열). 0006 이전 행은 NULL.
-- 거부 전 모델 원문은 저장하지 않는다(로컬 녹화 llm_trace만). 열 추가만 — 기존 행·인덱스는 그대로(rows written 없음).
ALTER TABLE answer_log ADD COLUMN violations TEXT CHECK (violations IS NULL OR json_valid(violations));
