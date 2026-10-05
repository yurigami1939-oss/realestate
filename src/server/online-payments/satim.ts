import "server-only";

import { z } from "zod";

/**
 * Client of the SATIM e-payment REST API (CIB and Edahabia cards; CLAUDE.md §7 Online payment):
 * `register.do` creates the order and returns the gateway's payment page, `confirmOrder.do`
 * tells whether it was paid (the only trusted answer: never the return URL's parameters),
 * `refund.do` gives the money back. Amounts in centimes, currency 012 (DZD).
 */

export type SatimAccount = {
  baseUrl: string;
  username: string;
  password: string;
  terminalId: string;
};

export type SatimLanguage = "fr" | "ar";

/** The gateway could not be reached or answered something unreadable. */
export class SatimUnavailableError extends Error {}

const TIMEOUT_MS = 20_000;
const DZD = "012";

const code = z.union([z.string(), z.number()]).transform(String);
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => (/^\d+$/.test(String(v)) ? BigInt(String(v)) : null));

const registerAnswer = z.object({
  orderId: z.string().optional(),
  formUrl: z.string().optional(),
  errorCode: code.optional(),
  errorMessage: z.string().optional(),
});

const confirmAnswer = z.object({
  OrderStatus: z.coerce.number().int().optional(),
  ErrorCode: code.optional(),
  ErrorMessage: z.string().optional(),
  OrderNumber: z.string().optional(),
  Amount: amount.optional(),
  approvalCode: z.string().optional(),
  Pan: z.string().optional(),
  actionCode: z.coerce.number().int().optional(),
  actionCodeDescription: z.string().optional(),
  params: z
    .object({ respCode: z.string().optional(), respCode_desc: z.string().optional() })
    .optional(),
});

const refundAnswer = z.object({
  errorCode: code.optional(),
  errorMessage: z.string().optional(),
});

async function call(
  account: SatimAccount,
  method: "register.do" | "confirmOrder.do" | "refund.do",
  params: Record<string, string>,
): Promise<unknown> {
  // POST keeps the merchant's credentials out of URLs and logs.
  const body = new URLSearchParams({
    userName: account.username,
    password: account.password,
    ...params,
  });
  let response: Response;
  try {
    response = await fetch(`${account.baseUrl.replace(/\/$/, "")}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SatimUnavailableError(`SATIM ${method}: ${String(error)}`);
  }
  if (!response.ok) throw new SatimUnavailableError(`SATIM ${method}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new SatimUnavailableError(`SATIM ${method}: not JSON`);
  }
}

function parse<S extends z.ZodType>(schema: S, value: unknown, method: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SatimUnavailableError(`SATIM ${method}: unexpected answer`);
  return parsed.data;
}

export type SatimOrder = {
  orderNumber: string;
  amount: bigint;
  returnUrl: string;
  failUrl: string;
  description: string;
  language: SatimLanguage;
};

export type SatimRegistration =
  | { ok: true; orderId: string; formUrl: string }
  | { ok: false; code: string; message: string | null };

/** `register.do`: the order and the page where the payer types the card. */
export async function satimRegister(
  account: SatimAccount,
  order: SatimOrder,
): Promise<SatimRegistration> {
  const answer = parse(
    registerAnswer,
    await call(account, "register.do", {
      orderNumber: order.orderNumber,
      amount: order.amount.toString(),
      currency: DZD,
      returnUrl: order.returnUrl,
      failUrl: order.failUrl,
      description: order.description,
      language: order.language.toUpperCase(),
      jsonParams: JSON.stringify({
        force_terminal_id: account.terminalId,
        udf1: order.orderNumber,
      }),
    }),
    "register.do",
  );
  if ((answer.errorCode ?? "0") === "0" && answer.orderId && answer.formUrl) {
    return { ok: true, orderId: answer.orderId, formUrl: answer.formUrl };
  }
  return { ok: false, code: answer.errorCode ?? "?", message: answer.errorMessage ?? null };
}

/** Where an order stands: paid, refused for good (declined, cancelled, unknown), or still open. */
export type SatimOutcome = "paid" | "declined" | "open";

export type SatimOrderState = {
  outcome: SatimOutcome;
  /** SATIM `OrderStatus`: 0 registered, 1 pre-authorized, 2 paid, 3 cancelled, 4 refunded,
   * 5 card authentication in progress, 6 declined. */
  orderStatus: number | null;
  errorCode: string;
  /** What the gateway says to the payer (`respCode_desc`, else `actionCodeDescription`). */
  message: string | null;
  approvalCode: string | null;
  pan: string | null;
  amount: bigint | null;
};

/** `confirmOrder.do`: the order's state, as the gateway sees it. */
export async function satimConfirm(
  account: SatimAccount,
  orderId: string,
  language: SatimLanguage,
): Promise<SatimOrderState> {
  const answer = parse(
    confirmAnswer,
    await call(account, "confirmOrder.do", { orderId, language: language.toUpperCase() }),
    "confirmOrder.do",
  );
  const errorCode = answer.ErrorCode ?? "0";
  const orderStatus = answer.OrderStatus ?? null;
  const outcome: SatimOutcome =
    errorCode === "0" && orderStatus === 2
      ? "paid"
      : // 2: declined (card details); 6: unknown order. Status 3, 4, 6: cancelled, refunded, declined.
        errorCode === "2" || errorCode === "6" || [3, 4, 6].includes(orderStatus ?? -1)
        ? "declined"
        : "open";
  const message =
    answer.params?.respCode_desc ||
    answer.actionCodeDescription ||
    (errorCode === "0" ? null : answer.ErrorMessage) ||
    null;
  return {
    outcome,
    orderStatus,
    errorCode,
    message,
    approvalCode: answer.approvalCode || null,
    pan: answer.Pan || null,
    amount: answer.Amount ?? null,
  };
}

/** `refund.do`: gives back (all or part of) a paid order. */
export async function satimRefund(
  account: SatimAccount,
  orderId: string,
  refunded: bigint,
): Promise<{ ok: true } | { ok: false; code: string; message: string | null }> {
  const answer = parse(
    refundAnswer,
    await call(account, "refund.do", { orderId, amount: refunded.toString(), currency: DZD }),
    "refund.do",
  );
  const errorCode = answer.errorCode ?? "0";
  return errorCode === "0"
    ? { ok: true }
    : { ok: false, code: errorCode, message: answer.errorMessage ?? null };
}
