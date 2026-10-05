/**
 * Demo online payment (CLAUDE.md §7): the demo promoter's SATIM account on the test platform,
 * open for installments and charges. Locally (DEV_GATEWAYS) the test platform is the stand-in
 * served by the app, which accepts these placeholder credentials; no real SATIM account.
 */
import type { TenantCtx } from "@/server/auth/session";
import { gatewaySettingsSchema } from "@/server/online-payments/schemas";
import { saveGatewaySettings } from "@/server/online-payments/service";

export async function seedOnlinePayments(owner: TenantCtx) {
  await saveGatewaySettings(
    owner,
    gatewaySettingsSchema.parse({
      enabled: true,
      environment: "test",
      username: "demo-marchand",
      password: "demo-satim-test",
      terminalId: "E010900000",
      salesEnabled: true,
      chargesEnabled: true,
    }),
  );
}
