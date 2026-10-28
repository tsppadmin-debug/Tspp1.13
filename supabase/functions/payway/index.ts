// ABA PayWay for The Social forms.
// Actions (POST JSON): { action: "checkout", tran_id } and { action: "verify", tran_id }.
// A POST with only { tran_id } and no action is treated as the PayWay pushback; it is never trusted,
// the payment is always confirmed by asking PayWay (check-transaction-2).
// Secrets: PAYWAY_MERCHANT_ID, PAYWAY_API_KEY, optional PAYWAY_ENV ("sandbox" default, or "live"), SITE_URL.
const MID = (Deno.env.get("PAYWAY_MERCHANT_ID") ?? "").trim();
const KEY = (Deno.env.get("PAYWAY_API_KEY") ?? "").trim();
const LIVE = (Deno.env.get("PAYWAY_ENV") ?? "sandbox") === "live";
const BASE = LIVE ? "https://checkout.payway.com.kh" : "https://checkout-sandbox.payway.com.kh";
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.thesocialphnompenh.com").replace(/\/$/, "");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DBH = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
async function setPayment(id: string, payment: unknown) {
  await fetch(`${SB_URL}/rest/v1/form_responses?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: DBH, body: JSON.stringify({ payment }) });
}

const ALLOWED = [SITE, "https://thesocialphnompenh.com", "https://www.thesocialphnompenh.com"];
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.includes(o) ? o : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

async function sign(data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  let s = "";
  sig.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
function reqTime() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

async function findByTran(tran: string) {
  if (!/^[A-Z0-9]{6,20}$/.test(tran)) return null;
  const r = await fetch(`${SB_URL}/rest/v1/form_responses?select=id,payment,forms(slug,title)&payment-%3E%3Etran_id=eq.${tran}&limit=1`, { headers: DBH });
  if (!r.ok) return null;
  const rows = await r.json();
  return (rows[0] ?? null) as { id: string; payment: Record<string, unknown>; forms: { slug: string; title: string } } | null;
}

// Hash order is fixed by PayWay. Fields we do not use are empty strings.
const ORDER = [
  "req_time", "merchant_id", "tran_id", "amount", "items", "shipping", "firstname", "lastname", "email", "phone",
  "type", "payment_option", "return_url", "cancel_url", "continue_success_url", "return_deeplink", "currency",
  "custom_fields", "return_params", "payout", "lifetime", "additional_params", "google_pay_token", "skip_success_page",
];

async function checkout(req: Request, tran: string) {
  const row = await findByTran(tran);
  if (!row) return json(req, { error: "not_found" }, 404);
  if (row.payment.status === "paid") return json(req, { status: "paid" });
  const amount = Number(row.payment.amount);
  if (!(amount >= 0.1)) return json(req, { error: "bad_amount" }, 400);
  const f: Record<string, string> = {
    req_time: reqTime(),
    merchant_id: MID,
    tran_id: tran,
    amount: amount.toFixed(2),
    items: b64(JSON.stringify([{ name: row.forms.title.slice(0, 60), quantity: 1, price: amount }])),
    type: "purchase",
    return_url: b64(`${SB_URL}/functions/v1/payway`),
    cancel_url: `${SITE}/f/${row.forms.slug}?cancelled=1`,
    continue_success_url: `${SITE}/f/${row.forms.slug}?paid=${tran}`,
    currency: "USD",
    lifetime: "60",
  };
  const hashInput = ORDER.map((k) => f[k] ?? "").join("");
  const hash = await sign(hashInput);
  console.log("payway checkout", JSON.stringify({ env: LIVE ? "live" : "sandbox", midLen: MID.length, keyLen: KEY.length, keyLooksHex: /^[0-9A-Fa-f]+$/.test(KEY), hashInput, hashLen: hash.length }));
  const fields: Record<string, string> = { hash };
  for (const k of ORDER) if (f[k]) fields[k] = f[k];
  return json(req, { action_url: `${BASE}/api/payment-gateway/v1/payments/purchase`, fields });
}

async function verify(req: Request, tran: string) {
  const row = await findByTran(tran);
  if (!row) return json(req, { error: "not_found" }, 404);
  if (row.payment.status === "paid") return json(req, { status: "paid" });
  const t = reqTime();
  const hash = await sign(t + MID + tran);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/payment-gateway/v1/payments/check-transaction-2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ req_time: t, merchant_id: MID, tran_id: tran, hash }),
    });
  } catch {
    return json(req, { status: "pending", note: "payway_unreachable" });
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* not json */ }
  const d = body?.data;
  const ok = body?.status?.code === "00" && d && (d.payment_status === "APPROVED" || Number(d.payment_status_code) === 0);
  if (!ok) {
    const st = String(d?.payment_status ?? "").toUpperCase();
    if (["DECLINED", "CANCELLED", "EXPIRED", "FAILED"].includes(st)) {
      await setPayment(row.id, { ...row.payment, status: "failed", payway_status: st });
      return json(req, { status: "failed" });
    }
    return json(req, { status: "pending" });
  }
  const paidAmt = Number(d.payment_amount ?? d.total_amount ?? 0);
  if (Math.abs(paidAmt - Number(row.payment.amount)) > 0.009) {
    await setPayment(row.id, { ...row.payment, status: "mismatch", paid_amount: paidAmt });
    return json(req, { status: "mismatch" });
  }
  await setPayment(row.id, { ...row.payment, status: "paid", paid_at: new Date().toISOString(), apv: d.apv ?? null, paid_amount: paidAmt, payway_status: d.payment_status ?? "APPROVED" });
  return json(req, { status: "paid" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  if (!MID || !KEY) return json(req, { error: "payway_not_configured" }, 503);
  let b: any = {};
  try { b = await req.json(); } catch { return json(req, { error: "bad_json" }, 400); }
  const tran = String(b?.tran_id ?? "");
  if (b?.action === "checkout") return checkout(req, tran);
  if (b?.action === "verify") return verify(req, tran);
  if (tran && !b?.action) {
    // PayWay pushback: confirm with PayWay, ignore whatever the body claims
    await verify(req, tran);
    return json(req, { ok: true });
  }
  return json(req, { error: "bad_request" }, 400);
});
