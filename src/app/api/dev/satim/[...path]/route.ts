import { satimStandInUrl } from "@/server/online-payments/gateway";
import { handleSatimStandIn } from "@/server/online-payments/satim-standin";
import { devGatewaysEnabled } from "@/server/stand-ins";

/** Local SATIM stand-in (DEV_GATEWAYS only; 404 otherwise). */
async function handle(request: Request, { params }: RouteContext<"/api/dev/satim/[...path]">) {
  if (!devGatewaysEnabled()) return new Response(null, { status: 404 });
  return handleSatimStandIn(request, (await params).path.join("/"), satimStandInUrl());
}

export { handle as GET, handle as POST };
