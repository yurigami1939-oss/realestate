import { handlePushStandIn } from "@/server/push/standin";
import { devGatewaysEnabled } from "@/server/stand-ins";

/** Local Web Push service stand-in (DEV_GATEWAYS only; 404 otherwise). */
async function handle(request: Request, { params }: RouteContext<"/api/dev/push/[...path]">) {
  if (!devGatewaysEnabled()) return new Response(null, { status: 404 });
  return handlePushStandIn(request, (await params).path.join("/"));
}

export { handle as GET, handle as POST };
