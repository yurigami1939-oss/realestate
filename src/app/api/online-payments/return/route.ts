import { env } from "@/env";
import { isLocale } from "@/i18n/locales";
import { isUuid } from "@/lib/ids";
import { returnFromGateway } from "@/server/online-payments/service";

/**
 * Where the gateway sends the payer back (CLAUDE.md §7 Online payment): the payment is confirmed
 * with the gateway itself (never from this URL's parameters), recorded when paid, then the payer
 * lands on its result page. No session needed: confirming is harmless and idempotent.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orgId = params.get("org") ?? "";
  const id = params.get("id") ?? "";
  if (!isUuid(orgId) || !isUuid(id)) return new Response(null, { status: 404 });
  const locale = await returnFromGateway(orgId, id);
  if (locale === null) return new Response(null, { status: 404 });
  const target = new URL(
    `/${isLocale(locale) ? locale : "fr"}/portal/payments/${id}`,
    env.BETTER_AUTH_URL,
  );
  return new Response(null, {
    status: 303,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
