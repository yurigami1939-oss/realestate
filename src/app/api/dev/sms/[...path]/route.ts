import { handleSmsStandIn } from "@/server/sms/standin";
import { devGatewaysEnabled } from "@/server/stand-ins";

/** Local SMS gateway stand-in (DEV_GATEWAYS only; 404 otherwise). */
async function handle(request: Request, { params }: RouteContext<"/api/dev/sms/[...path]">) {
  if (!devGatewaysEnabled()) return new Response(null, { status: 404 });
  return handleSmsStandIn(request, (await params).path.join("/"));
}

export { handle as GET, handle as POST };
