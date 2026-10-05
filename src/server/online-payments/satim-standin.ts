import "server-only";

import { randomBytes, randomInt } from "node:crypto";

/**
 * Local stand-in of the SATIM gateway (`/api/dev/satim/*`, DEV_GATEWAYS only): the same REST
 * calls and answers as SATIM's test platform, and a payment page with « Payer » / « Refuser » /
 * « Annuler » instead of a card form. Orders live in this process's memory, like a sandbox that
 * forgets them when the server restarts (they are then unknown, i.e. declined).
 */

type StandInOrder = {
  id: string;
  username: string;
  orderNumber: string;
  amount: bigint;
  returnUrl: string;
  failUrl: string;
  description: string;
  terminalId: string;
  udf1: string;
  /** 0 registered, 2 paid, 4 refunded, 6 declined. */
  status: 0 | 2 | 4 | 6;
  approvalCode: string | null;
};

const globalStore = globalThis as unknown as { satimStandIn?: Map<string, StandInOrder> };
const orders = (globalStore.satimStandIn ??= new Map<string, StandInOrder>());

const TEST_PAN = "628058**1011";

async function readParams(request: Request): Promise<URLSearchParams> {
  const params = new URL(request.url).searchParams;
  if (request.method === "POST") {
    const body = new URLSearchParams(await request.text());
    for (const [key, value] of body) params.set(key, value);
  }
  return params;
}

const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });

function register(params: URLSearchParams, base: string): Response {
  const get = (key: string) => params.get(key)?.trim() ?? "";
  const missing = ["userName", "password", "orderNumber", "amount", "currency", "returnUrl"].find(
    (key) => get(key) === "",
  );
  if (missing) return json({ errorCode: "4", errorMessage: `${missing} is empty` });
  if (get("currency") !== "012") return json({ errorCode: "3", errorMessage: "Unknown currency" });
  if (!/^\d+$/.test(get("amount")) || BigInt(get("amount")) < 5_000n) {
    return json({ errorCode: "5", errorMessage: "Invalid amount" });
  }
  if (get("orderNumber").length > 10) {
    return json({ errorCode: "5", errorMessage: "Invalid orderNumber" });
  }
  let extra: { force_terminal_id?: unknown; udf1?: unknown } = {};
  try {
    extra = JSON.parse(get("jsonParams") || "{}") as typeof extra;
  } catch {
    return json({ errorCode: "5", errorMessage: "Invalid jsonParams" });
  }
  if (typeof extra.force_terminal_id !== "string" || extra.force_terminal_id === "") {
    return json({ errorCode: "5", errorMessage: "force_terminal_id is required" });
  }
  const duplicate = [...orders.values()].some(
    (o) => o.username === get("userName") && o.orderNumber === get("orderNumber"),
  );
  if (duplicate) {
    return json({ errorCode: "1", errorMessage: "Order number already registered" });
  }
  const id = randomBytes(15).toString("base64url");
  orders.set(id, {
    id,
    username: get("userName"),
    orderNumber: get("orderNumber"),
    amount: BigInt(get("amount")),
    returnUrl: get("returnUrl"),
    failUrl: get("failUrl") || get("returnUrl"),
    description: get("description"),
    terminalId: extra.force_terminal_id,
    udf1: typeof extra.udf1 === "string" ? extra.udf1 : "",
    status: 0,
    approvalCode: null,
  });
  return json({ orderId: id, formUrl: `${base}/payment?mdOrder=${id}`, errorCode: "0" });
}

function confirm(params: URLSearchParams): Response {
  const order = orders.get(params.get("orderId") ?? "");
  if (!order || order.username !== params.get("userName")) {
    return json({ ErrorCode: "6", ErrorMessage: "Unregistered orderId" });
  }
  const accepted = order.status === 2 || order.status === 4;
  const message =
    order.status === 2
      ? "Votre paiement a été accepté"
      : order.status === 6
        ? "Votre transaction a été rejetée"
        : order.status === 4
          ? "Transaction remboursée"
          : "";
  return json({
    expiration: accepted ? "202812" : undefined,
    cardholderName: accepted ? "**********" : undefined,
    depositAmount: order.status === 2 ? Number(order.amount) : 0,
    currency: "012",
    approvalCode: order.approvalCode ?? undefined,
    authCode: 2,
    params: {
      udf1: order.udf1,
      ...(message ? { respCode: order.status === 6 ? "51" : "00", respCode_desc: message } : {}),
    },
    actionCode: order.status === 6 ? 116 : order.status === 0 ? -100 : 0,
    actionCodeDescription: message,
    ErrorCode: "0",
    ErrorMessage: "Success",
    OrderStatus: order.status,
    OrderNumber: order.orderNumber,
    Pan: accepted ? TEST_PAN : undefined,
    Amount: Number(order.amount),
    Ip: "127.0.0.1",
  });
}

function refund(params: URLSearchParams): Response {
  const order = orders.get(params.get("orderId") ?? "");
  if (!order || order.username !== params.get("userName")) {
    return json({ errorCode: "6", errorMessage: "Unregistered orderId" });
  }
  if (order.status !== 2) return json({ errorCode: "7", errorMessage: "Refund is not allowed" });
  const amount = params.get("amount") ?? "";
  if (!/^\d+$/.test(amount) || BigInt(amount) > order.amount) {
    return json({ errorCode: "5", errorMessage: "Invalid amount" });
  }
  order.status = 4;
  return json({ errorCode: "0", errorMessage: "Success" });
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function formatAmount(centimes: bigint): string {
  const dinars = (centimes / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${dinars},${(centimes % 100n).toString().padStart(2, "0")} DA`;
}

/** The payer's page: the order, then pay, decline or cancel. */
function page(order: StandInOrder | undefined, base: string): Response {
  const body = order
    ? `<p class="muted">Terminal ${escape(order.terminalId)} · Commande ${escape(order.orderNumber)}</p>
<p>${escape(order.description)}</p>
<p class="amount">${formatAmount(order.amount)}</p>
${
  order.status === 0
    ? `<form method="post" action="${base}/payment">
<input type="hidden" name="mdOrder" value="${escape(order.id)}">
<button name="decision" value="pay">Payer · ادفع</button>
<button name="decision" value="decline" class="secondary">Refuser la carte · رفض البطاقة</button>
<button name="decision" value="cancel" class="secondary">Annuler · إلغاء</button>
</form>`
    : `<p>Commande déjà traitée · تمت معالجة الطلب</p>`
}`
    : `<p>Commande inconnue · طلب غير معروف</p>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SATIM (simulation locale)</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f5;color:#18181b;margin:0;padding:24px}
main{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px #0002}
h1{font-size:18px;margin:0 0 4px}.muted{color:#71717a;font-size:13px}.amount{font-size:28px;font-weight:700}
.banner{background:#fef3c7;border-radius:8px;padding:8px 12px;font-size:13px}
button{display:block;width:100%;margin-top:8px;padding:12px;border:0;border-radius:8px;background:#166534;color:#fff;font-size:15px;cursor:pointer}
button.secondary{background:#e4e4e7;color:#18181b}</style></head>
<body><main><h1>Paiement CIB / Edahabia</h1>
<p class="banner">Simulation locale de la passerelle SATIM : aucune carte, aucun débit. · محاكاة محلية لبوابة الدفع</p>
${body}</main></body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function decide(params: URLSearchParams): Response {
  const order = orders.get(params.get("mdOrder") ?? "");
  if (!order) return new Response("Unknown order", { status: 404 });
  const decision = params.get("decision");
  if (order.status === 0 && decision === "pay") {
    order.status = 2;
    order.approvalCode = String(randomInt(100_000, 1_000_000));
  } else if (order.status === 0 && decision === "decline") {
    order.status = 6;
  }
  // Like SATIM: back to the merchant with the order id; cancelling leaves the order open.
  const target = new URL(order.status === 2 ? order.returnUrl : order.failUrl);
  target.searchParams.set("orderId", order.id);
  return new Response(null, { status: 303, headers: { Location: target.toString() } });
}

/** Dispatches `/api/dev/satim/<path>`; `base` is the stand-in's own URL. */
export async function handleSatimStandIn(
  request: Request,
  path: string,
  base: string,
): Promise<Response> {
  const params = await readParams(request);
  switch (path) {
    case "register.do":
      return register(params, base);
    case "confirmOrder.do":
      return confirm(params);
    case "refund.do":
      return refund(params);
    case "payment":
      return request.method === "POST"
        ? decide(params)
        : page(orders.get(params.get("mdOrder") ?? ""), base);
    default:
      return new Response(null, { status: 404 });
  }
}

/** Test helper: what the payer chose on the page, without a browser. */
export function decideStandInOrder(orderId: string, decision: "pay" | "decline"): void {
  const order = orders.get(orderId);
  if (!order || order.status !== 0) throw new Error(`stand-in: order ${orderId} not open`);
  order.status = decision === "pay" ? 2 : 6;
  if (decision === "pay") order.approvalCode = String(randomInt(100_000, 1_000_000));
}
