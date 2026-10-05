import { isUuid } from "@/lib/ids";
import { receiveWhatsappWebhook, verifyWhatsappWebhook } from "@/server/whatsapp/service";

/**
 * Meta's webhook for the organization's WhatsApp number (CLAUDE.md §7 WhatsApp). GET: the
 * verification Meta makes when the URL is set up. POST: delivery statuses and replies, signed
 * with the app secret.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/webhooks/whatsapp/[orgId]">,
) {
  const { orgId } = await params;
  if (!isUuid(orgId)) return new Response(null, { status: 404 });
  const challenge = await verifyWhatsappWebhook(orgId, new URL(request.url).searchParams);
  return challenge === null
    ? new Response(null, { status: 403 })
    : new Response(challenge, { headers: { "content-type": "text/plain" } });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/webhooks/whatsapp/[orgId]">,
) {
  const { orgId } = await params;
  if (!isUuid(orgId)) return new Response(null, { status: 404 });
  const accepted = await receiveWhatsappWebhook(
    orgId,
    await request.text(),
    request.headers.get("x-hub-signature-256"),
  );
  return new Response(null, { status: accepted ? 200 : 401 });
}
