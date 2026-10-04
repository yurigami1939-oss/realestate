import { describe, expect, it } from "vitest";

import { addDays, todayInAlgiers } from "@/lib/dates";
import { createChargeCategorySchema } from "@/server/charges/schemas";
import { createChargeCategory } from "@/server/charges/categories";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam, createTenantCtx } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getSupplier, listContractTargets, listResidenceContracts, listSuppliers } from "./queries";
import {
  createContractSchema,
  createSupplierSchema,
  updateContractSchema,
  updateSupplierSchema,
} from "./schemas";
import {
  createContract,
  createSupplier,
  deleteContract,
  deleteSupplier,
  updateContract,
  updateSupplier,
} from "./service";

const today = todayInAlgiers();

async function scenario() {
  const team = await createSalesTeam();
  const { projectId } = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: "Résidence Les Oliviers",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "5",
      callDueDays: "30",
    }),
  );
  const { id: categoryId } = await createChargeCategory(
    manager,
    createChargeCategorySchema.parse({
      residenceId,
      name: "Ascenseur",
      key: "share",
      weighting: "share",
      buildingId: "",
      unitIds: [],
    }),
  );
  return { team, manager, residenceId, categoryId };
}

const supplierInput = (overrides: Record<string, string> = {}) =>
  createSupplierSchema.parse({
    name: "Otis Algérie",
    activity: "Maintenance des ascenseurs",
    phone: "0550 11 22 33",
    email: "contact@otis.test",
    ...overrides,
  });

describe("suppliers", () => {
  it("are kept per organization with their contracts per residence", async () => {
    const { team, manager, residenceId, categoryId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);

    await expect(createSupplier(cashier, supplierInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: supplierId } = await createSupplier(manager, supplierInput());
    await updateSupplier(
      accountant,
      updateSupplierSchema.parse({
        supplierId,
        name: "Otis Algérie SPA",
        rib: "00799999000123456789",
      }),
    );

    const contract = (overrides: Record<string, string> = {}) =>
      createContractSchema.parse({
        supplierId,
        residenceId,
        categoryId,
        label: "Maintenance trimestrielle",
        startOn: addDays(today, -30),
        endOn: "",
        annualAmount: "240 000",
        ...overrides,
      });
    expect(() => contract({ endOn: addDays(today, -60) })).toThrow();
    // A category of another residence is refused.
    const other = await scenario();
    await expect(
      createContract(manager, contract({ categoryId: other.categoryId })),
    ).rejects.toMatchObject({ messageKey: "charges.errors.categoryNotFound" });

    const { id: running } = await createContract(manager, contract());
    const { id: future } = await createContract(
      manager,
      contract({ label: "Rénovation cabine", categoryId: "", startOn: addDays(today, 10) }),
    );
    expect(
      (await listResidenceContracts(accountant, residenceId)).map((c) => [
        c.label,
        c.categoryName,
        c.running,
        c.annualAmount,
      ]),
    ).toEqual([
      ["Rénovation cabine", null, false, 240_000_00n],
      ["Maintenance trimestrielle", "Ascenseur", true, 240_000_00n],
    ]);
    expect(await listSuppliers(accountant)).toMatchObject([
      { id: supplierId, name: "Otis Algérie SPA", runningContracts: 1 },
    ]);

    await updateContract(
      manager,
      updateContractSchema.parse({
        contractId: running,
        categoryId: "",
        label: "Maintenance",
        startOn: addDays(today, -30),
        endOn: addDays(today, -1),
        annualAmount: "",
      }),
    );
    await deleteContract(manager, future);
    const sheet = await getSupplier(accountant, supplierId);
    expect(sheet?.contracts.map((c) => [c.label, c.running, c.annualAmount])).toEqual([
      ["Maintenance", false, null],
    ]);
    expect((await listContractTargets(manager)).map((r) => r.categories.length)).toEqual([1]);

    // Other organizations never see it.
    expect(await getSupplier(await createTenantCtx(["owner"]), supplierId)).toBeNull();

    await deleteSupplier(manager, supplierId);
    expect(await listSuppliers(manager)).toEqual([]);
    expect(await getSupplier(manager, supplierId)).toBeNull();
  });
});
