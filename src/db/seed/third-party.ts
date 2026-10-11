/**
 * A building the demo company did not build and runs as syndic (CLAUDE.md §7 Residence
 * charges): « Immeuble Les Mimosas », a third party's building in Alger-Centre whose units are
 * delivered from the start and never for sale, its residence and the co-owners entered by hand.
 */
import { eq } from "drizzle-orm";

import { unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";
import {
  createBuildingSchema,
  createProjectSchema,
  generateUnitsSchema,
} from "@/server/inventory/schemas";
import { createBuilding, createProject, generateUnits } from "@/server/inventory/service";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence, distributeSharesByArea } from "@/server/residences/service";

export const THIRD_PARTY_RESIDENCE = "Résidence Les Mimosas";

const coOwners: { unit: string; lastName: string; firstName: string; phone: string }[] = [
  { unit: "M-00-01", lastName: "Hadjadj", firstName: "Rachid", phone: "0661 45 12 78" },
  { unit: "M-00-02", lastName: "Boukhalfa", firstName: "Naima", phone: "0770 31 64 09" },
  { unit: "M-01-01", lastName: "Mansouri", firstName: "Hocine", phone: "0552 18 47 63" },
  { unit: "M-01-02", lastName: "Zerrouki", firstName: "Leila", phone: "0698 72 05 14" },
  { unit: "M-02-01", lastName: "Bouzid", firstName: "Farid", phone: "0661 93 28 40" },
  { unit: "M-03-02", lastName: "Kherbouche", firstName: "Souad", phone: "0775 46 81 27" },
];

export async function seedThirdPartyBuilding(actors: { owner: TenantCtx; manager: TenantCtx }) {
  const { owner, manager } = actors;
  const { id: projectId } = await createProject(
    owner,
    createProjectSchema.parse({
      code: "MIMO",
      name: "Immeuble Les Mimosas",
      status: "delivered",
      thirdParty: true,
      address: "12, rue Larbi Ben M'hidi",
      commune: "Alger-Centre",
      wilaya: "Alger",
      description:
        "Immeuble des années 1980 confié en gestion par l'assemblée de ses copropriétaires.",
    }),
  );
  const { id: buildingId } = await createBuilding(
    owner,
    createBuildingSchema.parse({
      projectId,
      code: "M",
      name: "Immeuble",
      lowestFloor: "0",
      topFloor: "3",
    }),
  );
  await generateUnits(
    owner,
    generateUnitsSchema.parse({
      buildingId,
      fromFloor: "0",
      toFloor: "3",
      unitsPerFloor: "2",
      type: "apartment",
      typology: "F3",
      livingArea: "82",
    }),
  );
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: THIRD_PARTY_RESIDENCE,
      address: "12, rue Larbi Ben M'hidi",
      commune: "Alger-Centre",
      wilaya: "Alger",
      shareBasis: "1000",
      chargeFrequency: "quarterly",
      reserveFund: "5",
      callDueDays: "30",
      notes: "Mandat de syndic voté par l'assemblée générale des copropriétaires.",
    }),
  );
  await distributeSharesByArea(manager, residenceId);
  const units = new Map(
    (
      await withTenant(owner, (tx) =>
        tx.select({ id: unit.id, code: unit.code }).from(unit).where(eq(unit.projectId, projectId)),
      )
    ).map((u) => [u.code, u.id]),
  );
  for (const c of coOwners) {
    const unitId = units.get(c.unit);
    if (!unitId) throw new Error(`seed: ${c.unit} missing`);
    await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId,
        kind: "co_owner",
        isMain: true,
        lastName: c.lastName,
        firstName: c.firstName,
        phone: c.phone,
        email: "",
        sinceOn: "2019-01-01",
      }),
    );
  }
  return { projectId, residenceId };
}
