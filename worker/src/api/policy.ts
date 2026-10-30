// 증권번호는 어느 응답에도 없다(상위 §7 v1.6, 설계서 v0.1.12 §7): policyMasked(끝 4자 외 '*')와
// policyKey = HMAC-SHA256(POLICY_KEY_SECRET, tenant_id + U+001F + policy_no) 앞 16자 16진. 키 → 원문은 그 설계사의 증권번호 집합으로만 푼다.

export function policyMasked(policyNo: string): string {
  const keep = policyNo.length > 4 ? policyNo.slice(-4) : "";
  return "*".repeat(policyNo.length - keep.length) + keep;
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, k);
  }
  return k;
}

export async function policyKey(secret: string, tenantId: string, policyNo: string): Promise<string> {
  if (!secret) throw new Error("POLICY_KEY_SECRET 없음");
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${tenantId}\u001f${policyNo}`));
  return [...new Uint8Array(mac).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 증권번호 목록 → 키 맵(요청 안에서만 쓴다). */
export async function policyKeys(secret: string, tenantId: string, policyNos: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of new Set(policyNos)) out.set(p, await policyKey(secret, tenantId, p));
  return out;
}
