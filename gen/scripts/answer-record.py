# 부록 A 12건 답변 녹화 드라이버(운영자 2026-11-03 — phase-4.md "답변 녹화"). wrangler dev --env record(포트 8799)가 떠 있을 때:
#   python3 -X utf8 -I gen/scripts/answer-record.py docs/evidence/logs/phase-4-answer-record-<버전>-<날짜>.json
# 데모 1(A-1001) 세션으로 부록 A 원문 12문항을 POST /api/v1/me/ask, 60초 간격(Groq TPM 8K — 질문 1개 = 호출 2회 약 6K 토큰, 설계서 §10 "분당 2회"; 2026-11-04 v2 녹화는 30초 간격에서 A-02 2단계 503). 키는 서버(.dev.vars.record)에만 있다.
import json, time, urllib.request, sys
BASE = "http://localhost:8799/api/v1"
import os
# 부록 A 12건 원문 — capture-public.py와 같은 파일
QS = [(c["case"], c["question"]) for c in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "appendix-a.json"), encoding="utf8"))["cases"]]
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
