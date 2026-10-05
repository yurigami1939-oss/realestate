import { devGatewaysEnabled } from "@/server/stand-ins";
import { handleWhatsappStandIn } from "@/server/whatsapp/standin";

/** Local WhatsApp Cloud API stand-in (DEV_GATEWAYS only; 404 otherwise). */
async function handle(request: Request, { params }: RouteContext<"/api/dev/whatsapp/[...path]">) {
  if (!devGatewaysEnabled()) return new Response(null, { status: 404 });
  return handleWhatsappStandIn(request, (await params).path.join("/"));
}

export { handle as GET, handle as POST };
