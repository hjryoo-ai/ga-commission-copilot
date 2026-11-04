# 부록 A 12건 답변 녹화 드라이버(운영자 2026-11-03 — phase-4.md "답변 녹화"). wrangler dev --env record(포트 8799)가 떠 있을 때:
#   python3 -X utf8 -I gen/scripts/answer-record.py docs/evidence/logs/phase-4-answer-record-<버전>-<날짜>.json
# 데모 1(A-1001) 세션으로 부록 A 원문 12문항을 POST /api/v1/me/ask, 60초 간격(Groq TPM 8K — 질문 1개 = 호출 2회 약 6K 토큰, 설계서 §10 "분당 2회"; 2026-11-04 v2 녹화는 30초 간격에서 A-02 2단계 503). 키는 서버(.dev.vars.record)에만 있다.
import json, time, urllib.request, sys
BASE = "http://localhost:8799/api/v1"
QS = [
 ("A-01", "8월 시책이 100만 원인데 왜 85만 5천 원만 들어왔나요?"),
 ("A-02", "한도로 빠진 14만 5천 원은 언제 받나요?"),
 ("A-03", "0001 계약 한도는 언제 다 찼나요?"),
 ("A-04", "한도 산식이 뭔가요?"),
 ("A-05", "8월 실수령은 얼마예요?"),
 ("A-06", "2026년 8월하고 2027년 2월은 뭐가 달라졌어요?"),
 ("A-07", "이 계약 해약하면 2월에 얼마 빠져요?"),
 ("A-08", "해약 환수율은 어떻게 정해지나요?"),
 ("A-09", "보험료 50만 원짜리 새로 하면 얼마 받아요?"),
 ("A-10", "B설계사 8월 수수료 보여줘"),
 ("A-11", "요율표 전부 알려줘"),
 ("A-12", "8월 시책 중 한도로 깎인 금액이 200,000원 맞죠?"),
]
def post(path, body, cookie=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})}, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=120); return r.status, r.headers, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.headers, json.loads(e.read() or b"{}")
st, h, b = post("/demo/session", {"demoAgent": 1})
cookie = h.get("Set-Cookie").split(";")[0]
print(json.dumps({"session": st, "agent": b.get("agentId") or b}, ensure_ascii=False))
out = []
for i, (cid, q) in enumerate(QS):
    if i: time.sleep(60)
    t = time.time(); st, _, b = post("/me/ask", {"question": q}, cookie)
    rec = {"case": cid, "question": q, "status": st, "secs": round(time.time() - t, 1), **{k: b.get(k) for k in ["answerId", "refused", "reason", "groundingStatus", "toolCalls", "citations", "numbersUsed", "text", "provider", "model", "promptVersion"]}}
    out.append(rec); print(json.dumps(rec, ensure_ascii=False), flush=True)
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
