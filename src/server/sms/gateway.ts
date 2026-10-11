import "server-only";

/**
 * The SMS gateway's HTTP protocol (CLAUDE.md §7 SMS): `POST {baseUrl}/messages` with
 * `Authorization: Bearer {apiKey}` and JSON `{ from, to, text }` (`to` in E.164) → 2xx and
 * `{ id }`. Algerian operators' « SMS Pro » offers and aggregators each publish their own API:
 * this generic protocol (and the local stand-in that speaks it) is to be adapted to the
 * promoter's provider once its documentation and credentials are in hand.
 */
export type SmsGateway = { baseUrl: string; apiKey: string; sender: string };

export type SmsResult =
  | { ok: true; id: string }
  /** `retry`: the gateway was unreachable or throttling — the job tries again. */
  | { ok: false; error: string; retry: boolean };

const TIMEOUT_MS = 10_000;

export async function sendSms(
  gateway: SmsGateway,
  message: { to: string; text: string },
): Promise<SmsResult> {
  let response: Response;
  try {
    response = await fetch(`${gateway.baseUrl}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gateway.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: gateway.sender, to: message.to, text: message.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: `unreachable: ${String(error)}`, retry: true };
  }
  let body: { id?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // An empty or non-JSON answer: judged on its status.
  }
  if (response.ok && typeof body.id === "string") return { ok: true, id: body.id };
  const error = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
  const retry = response.status === 429 || response.status >= 500;
  return { ok: false, error, retry };
}
