import { afterAll, describe, expect, it } from "vitest";

import { stopEnqueue } from "@/jobs/enqueue";
import { wilayaCode } from "@/lib/wilayas";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createProjectSchema } from "@/server/inventory/schemas";
import { createProject } from "@/server/inventory/service";

import { createSalesTeam } from "../../../tests/factories";

import { listCommunes } from "./communes";

afterAll(async () => {
  await stopEnqueue();
});

describe("communes", () => {
  it("reads a wilaya however it was typed", () => {
    expect(wilayaCode("16 - Alger")).toBe("16");
    expect(wilayaCode("alger")).toBe("16");
    expect(wilayaCode("Béjaïa")).toBe("06");
    expect(wilayaCode("BEJAIA")).toBe("06");
    expect(wilayaCode("الجزائر")).toBe("16");
    expect(wilayaCode("9")).toBe("09");
    expect(wilayaCode("Paris")).toBeNull();
    expect(wilayaCode("")).toBeNull();
  });

  it("suggests the communes already used, each in its most used spelling", async () => {
    const team = await createSalesTeam();
    await createProject(
      team.manager,
      createProjectSchema.parse({
        code: "KOUB",
        name: "Résidence de Kouba",
        status: "planning",
        commune: "Kouba",
        wilaya: "16 - Alger",
      }),
    );
    const buyer = (commune: string, wilaya: string, phone: string) =>
      createBuyer(
        team.manager,
        createBuyerSchema.parse({
          lastName: "Bensalem",
          firstName: "Karim",
          phone,
          email: "",
          leadId: "",
          commune,
          wilaya,
        }),
      );
    await buyer("Kouba", "Alger", "0550 11 11 11");
    await buyer("kouba ", "", "0550 22 22 22");
    await buyer("Akbou", "Béjaïa", "0550 33 33 33");
    expect(await listCommunes(team.agentA)).toEqual([
      { commune: "Kouba", wilaya: "16" },
      { commune: "Akbou", wilaya: "06" },
    ]);
  });
});
