import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { formatSharesPercent } from "@/lib/assemblies";
import { addDays, todayInAlgiers } from "@/lib/dates";
import {
  addResidentSchema,
  createResidenceSchema,
  saveSharesSchema,
} from "@/server/residences/schemas";
import { addResident, createResidence, saveShares } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import {
  convocationHtml,
  loadConvocationData,
  loadMinutesData,
  minutesHtml,
  renderAndStoreConvocation,
  renderAndStoreMinutes,
} from "./documents";
import { getAssembly, listAssemblies } from "./queries";
import {
  addResolutionSchema,
  closeAssemblySchema,
  createAssemblySchema,
  saveAttendanceSchema,
  saveVotesSchema,
  updateAssemblySchema,
  updateResolutionSchema,
} from "./schemas";
import {
  addResolution,
  closeAssembly,
  conveneAssembly,
  createAssembly,
  deleteAssembly,
  deleteResolution,
  saveAttendance,
  saveVotes,
  updateAssembly,
  updateResolution,
} from "./service";

const today = todayInAlgiers();

const company = {
  name: "Promo",
  legalName: "SARL Promo",
  address: null,
  wilaya: null,
  phone: null,
  rcNumber: null,
  nif: null,
  nis: null,
  aiNumber: null,
  logo: null,
};

/**
 * A residence of three units (A-03-01, A-03-02, A-04-01) at 4000 / 3000 / 3000 tantièmes; the
 * first two have a co-owner, the third still belongs to the promoter.
 */
async function scenario() {
  const team = await createSalesTeam();
  const { projectId, unitIds } = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: "Résidence Les Oliviers",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "0",
      callDueDays: "30",
    }),
  );
  await saveShares(
    manager,
    saveSharesSchema.parse({
      residenceId,
      shares: unitIds.map((unitId, index) => ({ unitId, share: index === 0 ? "4000" : "3000" })),
    }),
  );
  for (const [unitId, lastName, firstName] of [
    [unitIds[0], "Saïdi", "Yasmine"],
    [unitIds[1], "Benali", "Omar"],
  ] as const) {
    await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId,
        kind: "co_owner",
        isMain: true,
        lastName,
        firstName,
        sinceOn: "2026-01-01",
      }),
    );
  }
  return { team, manager, residenceId, unitIds };
}

const assemblyInput = (residenceId: string, overrides: Record<string, string> = {}) =>
  createAssemblySchema.parse({
    residenceId,
    kind: "ordinary",
    heldOn: today,
    startTime: "18:30",
    place: "Salle polyvalente de la résidence",
    notes: "",
    ...overrides,
  });

const resolutionInput = (assemblyId: string, title: string, majority: string, titleAr = "") =>
  addResolutionSchema.parse({ assemblyId, title, titleAr, description: "", majority });

async function auditActions(scope: { orgId: string }, entityId: string) {
  const rows = await withTenant(scope, (tx) =>
    tx
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      .orderBy(asc(auditLog.createdAt)),
  );
  return rows.map((r) => r.action);
}

describe("general assemblies", () => {
  it("are drafted with their agenda, then convened once with a bilingual convocation", async () => {
    const { team, manager, residenceId } = await scenario();
    const accountant = await addMember(team.orgId, ["accountant"]);
    const other = await scenario();

    expect(() => assemblyInput(residenceId, { startTime: "25:00" })).toThrow();
    await expect(createAssembly(accountant, assemblyInput(residenceId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(listAssemblies(accountant, residenceId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const heldOn = addDays(today, 21);
    const { id } = await createAssembly(manager, assemblyInput(residenceId, { heldOn }));
    expect(await getAssembly(other.manager, residenceId, id)).toBeNull();
    await updateAssembly(
      manager,
      updateAssemblySchema.parse({
        assemblyId: id,
        kind: "extraordinary",
        heldOn,
        startTime: "18:00",
        place: "Salle polyvalente",
        notes: "",
      }),
    );

    await expect(conveneAssembly(manager, id)).rejects.toMatchObject({
      messageKey: "assemblies.errors.emptyAgenda",
    });
    const { id: first } = await addResolution(
      manager,
      resolutionInput(id, "Approbation des comptes 2026", "simple"),
    );
    const { id: second } = await addResolution(
      manager,
      resolutionInput(id, "Désignation du gestionnaire", "absolute"),
    );
    await addResolution(
      manager,
      resolutionInput(id, "Travaux d'étanchéité", "two_thirds", "أشغال العزل المائي"),
    );
    await updateResolution(
      manager,
      updateResolutionSchema.parse({
        resolutionId: second,
        title: "Renouvellement du gestionnaire",
        titleAr: "",
        description: "Pour deux ans.",
        majority: "absolute",
      }),
    );
    await deleteResolution(manager, first);
    expect(
      (await getAssembly(manager, residenceId, id))?.resolutions.map((r) => [r.position, r.title]),
    ).toEqual([
      [1, "Renouvellement du gestionnaire"],
      [2, "Travaux d'étanchéité"],
    ]);

    // A draft can be dropped; a convened assembly cannot.
    const { id: draft } = await createAssembly(manager, assemblyInput(residenceId));
    await deleteAssembly(manager, draft);
    expect(await listAssemblies(manager, residenceId)).toMatchObject([
      { id, status: "draft", resolutions: 2, adopted: 0 },
    ]);

    await conveneAssembly(manager, id);
    const notDraft = { messageKey: "assemblies.errors.notDraft" };
    await expect(conveneAssembly(manager, id)).rejects.toMatchObject(notDraft);
    await expect(
      addResolution(manager, resolutionInput(id, "Questions diverses", "simple")),
    ).rejects.toMatchObject(notDraft);
    await expect(deleteResolution(manager, second)).rejects.toMatchObject(notDraft);
    await expect(deleteAssembly(manager, id)).rejects.toMatchObject(notDraft);

    const loaded = await withTenant(team.owner, (tx) => loadConvocationData(tx, id));
    if (!loaded) throw new Error("convocation not found");
    expect(loaded.data).toMatchObject({
      residenceName: "Résidence Les Oliviers",
      kind: "extraordinary",
      heldOn,
      startTime: "18:00",
      agenda: [
        { position: 1, title: "Renouvellement du gestionnaire", majority: "absolute" },
        { position: 2, titleAr: "أشغال العزل المائي", majority: "two_thirds" },
      ],
    });
    const html = convocationHtml(loaded.data, company);
    expect(html).toContain("ASSEMBLÉE GÉNÉRALE EXTRAORDINAIRE");
    expect(html).toContain("استدعاء إلى الجمعية العامة غير العادية");
    expect(html).toContain("Majorité absolue des tantièmes");
    expect(await renderAndStoreConvocation(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreConvocation(team.orgId, id)).toBe("skipped");
    expect((await getAssembly(manager, residenceId, id))?.convocationFileId).not.toBeNull();
    expect(await auditActions(team.owner, id)).toEqual(["assembly.convene"]);
  });

  it("weigh votes by tantièmes and freeze the results and the minutes at closing", async () => {
    const { team, manager, residenceId, unitIds } = await scenario();
    const [u1, u2, u3] = unitIds;
    const other = await scenario();
    const { id } = await createAssembly(manager, assemblyInput(residenceId));
    const resolution = async (title: string, majority: string) =>
      (await addResolution(manager, resolutionInput(id, title, majority))).id;
    const accounts = await resolution("Approbation des comptes", "simple");
    const appointment = await resolution("Désignation du gestionnaire", "absolute");
    const works = await resolution("Ravalement des façades", "two_thirds");
    const rules = await resolution("Modification du règlement", "unanimity");

    const attendance = (rows: { unitId: string; kind: string; proxyName?: string }[]) =>
      saveAttendanceSchema.parse({
        assemblyId: id,
        rows: rows.map((r) => ({ proxyName: "", ...r })),
      });
    const allThere = attendance([
      { unitId: u1, kind: "present" },
      { unitId: u2, kind: "represented", proxyName: "Benali Karim" },
      // The promoter votes the units it still owns.
      { unitId: u3, kind: "present" },
    ]);
    await expect(saveAttendance(manager, allThere)).rejects.toMatchObject({
      messageKey: "assemblies.errors.notConvened",
    });
    await conveneAssembly(manager, id);

    expect(() => attendance([{ unitId: u2, kind: "represented" }])).toThrow();
    await expect(
      saveAttendance(manager, attendance([{ unitId: other.unitIds[0], kind: "present" }])),
    ).rejects.toMatchObject({ messageKey: "residences.errors.unitNotInResidence" });
    const close = closeAssemblySchema.parse({
      assemblyId: id,
      chairName: "Saïdi Yasmine",
      secretaryName: "Kaci Omar",
      endTime: "20:15",
    });
    await expect(closeAssembly(manager, close)).rejects.toMatchObject({
      messageKey: "assemblies.errors.noAttendance",
    });
    expect(await saveAttendance(manager, allThere)).toEqual({
      voters: 3,
      shares: 10_000,
      totalShares: 10_000,
    });

    const votes = (list: [string, string, string][]) =>
      saveVotesSchema.parse({
        assemblyId: id,
        votes: list.map(([resolutionId, unitId, choice]) => ({ resolutionId, unitId, choice })),
      });
    await saveVotes(
      manager,
      votes([
        [accounts, u1, "for"],
        [accounts, u2, "against"],
        [accounts, u3, "abstain"],
        [appointment, u1, "for"],
        [appointment, u3, "for"],
        [works, u1, "for"],
        [works, u2, "for"],
        [rules, u1, "for"],
        [rules, u2, "for"],
        [rules, u3, "for"],
      ]),
    );
    // The promoter finally left before the votes: its votes are withdrawn.
    expect(
      await saveAttendance(
        manager,
        attendance([
          { unitId: u1, kind: "present" },
          { unitId: u2, kind: "represented", proxyName: "Benali Karim" },
        ]),
      ),
    ).toEqual({ voters: 2, shares: 7_000, totalShares: 10_000 });
    await expect(saveVotes(manager, votes([[accounts, u3, "for"]]))).rejects.toMatchObject({
      messageKey: "assemblies.errors.notVoting",
    });
    await expect(
      saveVotes(
        manager,
        votes([
          [accounts, u1, "for"],
          [accounts, u1, "against"],
        ]),
      ),
    ).rejects.toMatchObject({ messageKey: "assemblies.errors.duplicateVote" });

    let sheet = await getAssembly(manager, residenceId, id);
    expect(sheet?.sheet.map((u) => [u.code, u.kind, u.coOwnerName, u.proxyName, u.share])).toEqual([
      ["A-03-01", "present", "Saïdi Yasmine", null, 4000],
      ["A-03-02", "represented", "Benali Omar", "Benali Karim", 3000],
      ["A-04-01", "absent", null, null, 3000],
    ]);
    expect(sheet?.votes).toHaveLength(7);
    expect(sheet?.shares).toBe(10_000);

    // An assembly is closed once held, never before its day.
    const { id: next } = await createAssembly(
      manager,
      assemblyInput(residenceId, { heldOn: addDays(today, 1) }),
    );
    await addResolution(manager, resolutionInput(next, "Budget 2027", "simple"));
    await conveneAssembly(manager, next);
    await saveAttendance(
      manager,
      saveAttendanceSchema.parse({ assemblyId: next, rows: [{ unitId: u1, kind: "present" }] }),
    );
    await expect(closeAssembly(manager, { ...close, assemblyId: next })).rejects.toMatchObject({
      messageKey: "assemblies.errors.notHeldYet",
    });

    expect(await closeAssembly(manager, close)).toEqual({ adopted: 2, resolutions: 4 });
    sheet = await getAssembly(manager, residenceId, id);
    expect(sheet).toMatchObject({
      status: "closed",
      totalShares: 10_000,
      chairName: "Saïdi Yasmine",
      secretaryName: "Kaci Omar",
      endTime: "20:15",
    });
    expect(
      sheet?.resolutions.map((r) => [
        r.position,
        r.sharesFor,
        r.sharesAgainst,
        r.sharesAbstain,
        r.adopted,
      ]),
    ).toEqual([
      // Simple majority: 4000 for, 3000 against.
      [1, 4000, 3000, 0, true],
      // Absolute majority: 4000 of 10 000 is not more than half.
      [2, 4000, 0, 0, false],
      // Two thirds: 7000 of 10 000.
      [3, 7000, 0, 0, true],
      // Unanimity: the absent promoter's 3000 are missing.
      [4, 7000, 0, 0, false],
    ]);
    expect(await listAssemblies(manager, residenceId)).toMatchObject([
      { id: next, status: "convened" },
      { id, status: "closed", resolutions: 4, adopted: 2 },
    ]);

    const closed = { messageKey: "assemblies.errors.closed" };
    await expect(saveAttendance(manager, allThere)).rejects.toMatchObject(closed);
    await expect(saveVotes(manager, votes([]))).rejects.toMatchObject(closed);
    await expect(closeAssembly(manager, close)).rejects.toMatchObject(closed);

    // Later changes of tantièmes leave the frozen sheet as it was.
    await saveShares(
      manager,
      saveSharesSchema.parse({
        residenceId,
        shares: [
          { unitId: u1, share: "5000" },
          { unitId: u2, share: "2500" },
          { unitId: u3, share: "2500" },
        ],
      }),
    );
    sheet = await getAssembly(manager, residenceId, id);
    expect(sheet?.sheet.map((u) => u.share)).toEqual([4000, 3000, 3000]);
    expect(sheet?.shares).toBe(10_000);

    const loaded = await withTenant(team.owner, (tx) => loadMinutesData(tx, id));
    if (!loaded) throw new Error("minutes not found");
    expect(loaded.data).toMatchObject({
      totalShares: 10_000,
      chairName: "Saïdi Yasmine",
      endTime: "20:15",
      attendance: [
        { unitCode: "A-03-01", kind: "present", share: 4000 },
        { unitCode: "A-03-02", kind: "represented", proxyName: "Benali Karim" },
        { unitCode: "A-04-01", kind: "absent", coOwnerName: null },
      ],
    });
    expect(loaded.data.resolutions[0]).toMatchObject({
      for: 4000,
      against: 3000,
      adopted: true,
      opponents: ["A-03-02 (Benali Omar)"],
      abstainers: [],
    });
    const html = minutesHtml(loaded.data, company);
    expect(html).toContain("ASSEMBLÉE GÉNÉRALE ORDINAIRE");
    expect(html).toContain("محضر الجمعية العامة العادية");
    expect(html).toContain("Résolution adoptée");
    expect(html).toContain("Résolution rejetée");
    expect(html).toContain("Promoteur (lot non attribué)");
    expect(html).toContain(formatSharesPercent(7_000, 10_000));
    expect(await renderAndStoreMinutes(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreMinutes(team.orgId, id)).toBe("skipped");
    expect((await getAssembly(manager, residenceId, id))?.minutesFileId).not.toBeNull();
    expect(await auditActions(team.owner, id)).toEqual(["assembly.convene", "assembly.close"]);
  });
});
