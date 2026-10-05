import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Client of the WhatsApp Cloud API (Meta Graph API): sends approved template messages from the
 * organization's number (CLAUDE.md §7 WhatsApp).
 */

export type CloudAccount = { baseUrl: string; phoneNumberId: string; accessToken: string };

export type TemplateMessage = {
  /** `wa_id`: international number without « + ». */
  to: string;
  template: string;
  language: "fr" | "ar";
  params: string[];
};

export type SendResult =
  | { ok: true; wamid: string }
  /** `retry`: worth trying again later (Meta down, throttled); otherwise final. */
  | { ok: false; retry: boolean; error: string };

const TIMEOUT_MS = 20_000;
/** Throttling codes: too many messages for now (app, account, pair, spam rate limits). */
const RETRY_CODES = new Set([4, 80007, 130429, 131048, 131056]);

const accepted = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) });
const failure = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.number().optional(),
    error_data: z.object({ details: z.string().optional() }).optional(),
  }),
});

/** `POST /{phone-number-id}/messages` with a template and its body parameters. */
export async function sendTemplate(
  account: CloudAccount,
  message: TemplateMessage,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(
      `${account.baseUrl.replace(/\/$/, "")}/${account.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.to,
          type: "template",
          template: {
            name: message.template,
            language: { code: message.language },
            components: [
              {
                type: "body",
                parameters: message.params.map((text) => ({ type: "text", text })),
              },
            ],
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (error) {
    return { ok: false, retry: true, error: `unreachable: ${String(error)}` };
  }
  const body: unknown = await response.json().catch(() => null);
  const sent = accepted.safeParse(body);
  if (response.ok && sent.success) return { ok: true, wamid: sent.data.messages[0]?.id ?? "" };
  const refused = failure.safeParse(body);
  const code = refused.success ? refused.data.error.code : undefined;
  const text = refused.success
    ? [refused.data.error.message, refused.data.error.error_data?.details]
        .filter(Boolean)
        .join(" — ")
    : `HTTP ${response.status}`;
  return {
    ok: false,
    retry: response.status >= 500 || response.status === 429 || RETRY_CODES.has(code ?? -1),
    error: code ? `${code}: ${text}` : text,
  };
}

/** Meta signs webhook calls with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function validWebhookSignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the webhook tells: delivery statuses and replies (`entry[].changes[].value`). */
const webhookPayload = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  statuses: z
                    .array(
                      z.object({
                        id: z.string(),
                        status: z.string(),
                        timestamp: z.string().optional(),
                        errors: z
                          .array(
                            z.object({
                              code: z.number().optional(),
                              title: z.string().optional(),
                              message: z.string().optional(),
                            }),
                          )
                          .optional(),
                      }),
                    )
                    .optional(),
                  messages: z
                    .array(
                      z.object({
                        from: z.string(),
                        type: z.string().optional(),
                        text: z.object({ body: z.string() }).optional(),
                        button: z.object({ text: z.string().optional() }).optional(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type WebhookEvents = {
  statuses: { wamid: string; status: string; at: Date; error: string | null }[];
  replies: { from: string; text: string }[];
};

/** Flattens a webhook call into delivery statuses and text replies (null if unreadable). */
export function readWebhook(rawBody: string): WebhookEvents | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = webhookPayload.safeParse(json);
  if (!parsed.success) return null;
  const values = (parsed.data.entry ?? []).flatMap((e) =>
    (e.changes ?? []).flatMap((c) => (c.value ? [c.value] : [])),
  );
  return {
    statuses: values.flatMap((v) =>
      (v.statuses ?? []).map((s) => ({
        wamid: s.id,
        status: s.status,
        at: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
        error:
          s.errors
            ?.map((e) => [e.code, e.title ?? e.message].filter(Boolean).join(": "))
            .join("; ") || null,
      })),
    ),
    replies: values.flatMap((v) =>
      (v.messages ?? []).flatMap((m) => {
        const text = m.text?.body ?? m.button?.text;
        return text ? [{ from: m.from, text }] : [];
      }),
    ),
  };
}
