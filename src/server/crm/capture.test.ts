import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/organizations/[orgId]/leads/route";
import { lead } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createCaptureKey, listCaptureKeys, revokeCaptureKey } from "./capture";
import { createCaptureKeySchema } from "./schemas";

afterAll(async () => {
  await stopEnqueue();
});

const send = (orgId: string, key: string, body: string, type = "application/json") =>
  POST(
    new Request(`http://localhost/api/v1/organizations/${orgId}/leads`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": type },
      body,
    }),
    { params: Promise.resolve({ orgId }) },
  );

describe("lead capture", () => {
  it("creates leads sent with a live key, as its creator, then refuses a revoked key", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const keyInput = createCaptureKeySchema.parse({
      name: "Site web",
      source: "website",
      projectId: setup.projectId,
    });
    await expect(createCaptureKey(team.agentA, keyInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: keyId, key } = await createCaptureKey(team.manager, keyInput);
    expect(key).toMatch(/^lck_/);

    // JSON with French field names, then a form post with another source.
    const first = await send(
      team.orgId,
      key,
      JSON.stringify({ nom: "Samira Boudiaf", telephone: "0661 45 78 12", message: "Un F3" }),
    );
    expect(first.status).toBe(200);
    const second = await send(
      team.orgId,
      key,
      new URLSearchParams({
        full_name: "Samira B.",
        phone_number: "+213661457812",
        source: "facebook",
        campaign: "Lead Ads octobre",
      }).toString(),
      "application/x-www-form-urlencoded",
    );
    expect(await second.json()).toMatchObject({ ok: true, data: { duplicate: true } });

    const leads = await withTenant(team.owner, (tx) =>
      tx
        .select({
          fullName: lead.fullName,
          source: lead.source,
          sourceDetail: lead.sourceDetail,
          projectId: lead.projectId,
          assignedTo: lead.assignedTo,
          createdBy: lead.createdBy,
          notes: lead.notes,
        })
        .from(lead)
        .where(eq(lead.phone, "+213661457812")),
    );
    expect(leads).toEqual(
      expect.arrayContaining([
        {
          fullName: "Samira Boudiaf",
          source: "website",
          sourceDetail: "Site web",
          projectId: setup.projectId,
          assignedTo: null,
          createdBy: team.manager.userId,
          notes: "Un F3",
        },
        expect.objectContaining({ source: "facebook", sourceDetail: "Lead Ads octobre" }),
      ]),
    );

    expect((await send(team.orgId, key, JSON.stringify({ nom: "Sans téléphone" }))).status).toBe(
      400,
    );
    expect(
      (
        await send(
          team.orgId,
          "lck_wrong",
          JSON.stringify({ nom: "Samira Boudiaf", telephone: "0661 45 78 12" }),
        )
      ).status,
    ).toBe(401);
    expect((await listCaptureKeys(team.manager))[0]?.lastUsedAt).toBeInstanceOf(Date);
    await revokeCaptureKey(team.manager, { keyId });
    const refused = await send(
      team.orgId,
      key,
      JSON.stringify({ nom: "Samira Boudiaf", telephone: "0661 45 78 12" }),
    );
    expect(refused.status).toBe(401);
  });
});
