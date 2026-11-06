# 공개 URL 부록 A 12건 캡처(설계서 v0.1.25 §11 capture-public.yml, 운영자 2026-11-05 — Phase 4 완료 기준 "실호출 12건 수동 확인 캡처"·"answer_log 12행").
#   python3 -X utf8 -I gen/scripts/capture-public.py <base URL> <출력 디렉터리> [기대 answer 버전(v3)]
# 데모 1(A-1001) 세션 → GET /me로 활성 answer 버전 확인(다르면 묻기 전에 멈춘다) → 12문항 POST /me/ask(60초 간격 — Groq TPM 8K)
# → 각 답의 GET /answers/{id}(원격 answer_log 행 — violations 열 포함, g1Shape는 설계서 v0.1.26부터)를 <case>.ask.json·<case>.answer.json으로, 요약은 index.json.
# 시크릿을 쓰지 않는다(공개 데모 세션). 쿠키는 파일에 남기지 않는다.
import json, os, sys, time, urllib.error, urllib.request

BASE = sys.argv[1].rstrip("/") + "/api/v1"
OUT = sys.argv[2]
EXPECT = sys.argv[3] if len(sys.argv) > 3 else "v3"
UA = {"User-Agent": "ga-commission-copilot-capture"}
CASES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "appendix-a.json"), encoding="utf8"))["cases"]


def call(method, path, body=None, cookie=None):
    headers = {**UA, **({"Content-Type": "application/json"} if body is not None else {}), **({"Cookie": cookie} if cookie else {})}
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.status, r.headers, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try:
            return e.code, e.headers, json.loads(raw)
        except ValueError:
            return e.code, e.headers, {"raw": raw.decode("utf8", "replace")[:500]}


def save(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


os.makedirs(OUT, exist_ok=True)
st, h, b = call("POST", "/demo/session", {"demoAgent": 1})
if st != 200:
    sys.exit(f"세션 실패 {st}: {b}")
cookie = h.get("Set-Cookie").split(";")[0]
st, _, me = call("GET", "/me", cookie=cookie)
active = (me.get("promptVersions") or {}).get("answer")
print(json.dumps({"session": st, "agentId": me.get("agentId"), "asOf": me.get("asOf"), "promptVersions": me.get("promptVersions")}, ensure_ascii=False), flush=True)
if active != EXPECT:
    sys.exit(f"활성 answer 버전 {active} ≠ 기대 {EXPECT} — 배포를 확인하고 다시(질문하지 않았다)")

index, bad = [], 0
for i, c in enumerate(CASES):
    if i:
        time.sleep(60)
    t = time.time()
    st, _, r = call("POST", "/me/ask", {"question": c["question"]}, cookie)
    secs = round(time.time() - t, 1)
    save(f"{c['case']}.ask.json", {"case": c["case"], "question": c["question"], "httpStatus": st, "secs": secs, "response": r})
    aid = r.get("answerId")
    row = None
    if aid:
        ast, _, row = call("GET", f"/answers/{aid}", cookie=cookie)
        save(f"{c['case']}.answer.json", {"case": c["case"], "httpStatus": ast, "answer": row})
    rec = {
        "case": c["case"],
        "answerId": aid,
        "httpStatus": st,
        "secs": secs,
        **{k: r.get(k) for k in ["refused", "reason", "groundingStatus", "promptVersion", "provider", "model", "rulesUnavailable"]},
        "violations": (row or {}).get("violations"),
    }
    if st not in (200, 429) or not aid or (row or {}).get("violations") is None:
        bad += 1
    index.append(rec)
    print(json.dumps(rec, ensure_ascii=False), flush=True)
    save("index.json", {"base": sys.argv[1], "expectAnswer": EXPECT, "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cases": index})

print(f"끝: {len(index)}건, 문제 {bad}건(HTTP·answerId 없음·violations 없음)")
sys.exit(1 if bad else 0)
