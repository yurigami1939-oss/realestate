/**
 * Demo inventory (module 1): 2 projects, 3 buildings, 118 units, price lists and blocked units.
 * Written through the services so histories, audit rows and invariants are the real ones.
 */
import type { z } from "zod";

import { defaultUnitCode, type Orientation, type Typology, type UnitType } from "@/lib/inventory";
import { adjustByBasisPoints, toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { applyPriceList, createPriceList, setPriceListItems } from "@/server/inventory/price-lists";
import {
  createBuildingSchema,
  createPriceListSchema,
  createProjectSchema,
  createUnitSchema,
  setPriceListItemsSchema,
  unitStatusReasonSchema,
  updateUnitPriceSchema,
} from "@/server/inventory/schemas";
import {
  blockUnit,
  createBuilding,
  createProject,
  createUnit,
  updateUnitPrice,
} from "@/server/inventory/service";

const DA = 100n;

type UnitSpec = {
  type: UnitType;
  typology?: Typology;
  isDuplex?: boolean;
  livingArea?: string;
  usableArea?: string;
  outdoorArea?: string;
  orientations?: Orientation[];
  /** Price per m² in DA (on the living area, or the usable area without one)… */
  perSqm?: number;
  /** …or a flat price in DA (parking, storage). */
  flat?: number;
};

type FloorSpec = { floor: number; units: UnitSpec[] };
type BuildingSpec = {
  code: string;
  name: string;
  lowestFloor: number;
  topFloor: number;
  /** Premium per floor above the first, in basis points (150 = +1.5 % per floor). */
  floorPremiumBp: number;
  floors: FloorSpec[];
};
type ProjectSpec = {
  project: z.input<typeof createProjectSchema>;
  buildings: BuildingSpec[];
  priceListName: string;
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const repeat = (floors: number[], units: UnitSpec[]): FloorSpec[] =>
  floors.map((floor) => ({ floor, units }));

const olivApartments: UnitSpec[] = [
  {
    type: "apartment",
    typology: "F2",
    livingArea: "62.40",
    usableArea: "58.10",
    outdoorArea: "6.20",
    orientations: ["N", "E"],
    perSqm: 150_000,
  },
  {
    type: "apartment",
    typology: "F3",
    livingArea: "86.75",
    usableArea: "81.30",
    outdoorArea: "8.40",
    orientations: ["E"],
    perSqm: 150_000,
  },
  {
    type: "apartment",
    typology: "F3",
    livingArea: "88.20",
    usableArea: "82.60",
    outdoorArea: "8.40",
    orientations: ["S", "W"],
    perSqm: 150_000,
  },
  {
    type: "apartment",
    typology: "F4",
    livingArea: "112.50",
    usableArea: "105.90",
    outdoorArea: "12.00",
    orientations: ["S", "E"],
    perSqm: 150_000,
  },
];

const cornApartments: UnitSpec[] = [
  {
    type: "apartment",
    typology: "F3",
    livingArea: "92.30",
    usableArea: "86.90",
    outdoorArea: "10.50",
    orientations: ["N"],
    perSqm: 185_000,
  },
  {
    type: "apartment",
    typology: "F3",
    livingArea: "95.10",
    usableArea: "89.40",
    outdoorArea: "10.50",
    orientations: ["N", "E"],
    perSqm: 185_000,
  },
  {
    type: "apartment",
    typology: "F4",
    livingArea: "124.60",
    usableArea: "117.20",
    outdoorArea: "14.80",
    orientations: ["N", "W"],
    perSqm: 185_000,
  },
  {
    type: "apartment",
    typology: "F5",
    livingArea: "148.90",
    usableArea: "140.30",
    outdoorArea: "22.00",
    orientations: ["N", "E", "W"],
    perSqm: 185_000,
  },
];

export const demoProjects: ProjectSpec[] = [
  {
    project: {
      code: "OLIV",
      name: "Résidence Les Oliviers",
      status: "under_construction",
      address: "Route de Draria, lot 42",
      wilaya: "16 - Alger",
      commune: "Draria",
      buildingPermitNumber: "PC 16/0987/2024",
      buildingPermitDate: "2024-03-12",
      launchedOn: "2024-06-01",
      plannedDeliveryOn: "2027-06-30",
      description: "Deux blocs R+8 avec commerces en pied d'immeuble et parking en sous-sol.",
    },
    buildings: [
      {
        code: "A",
        name: "Bloc A",
        lowestFloor: -1,
        topFloor: 8,
        floorPremiumBp: 150,
        floors: [
          {
            floor: -1,
            units: Array.from({ length: 6 }, (): UnitSpec => ({
              type: "parking",
              usableArea: "12.50",
              flat: 1_800_000,
            })),
          },
          {
            floor: 0,
            units: [
              { type: "commercial", usableArea: "78.00", orientations: ["S"], perSqm: 230_000 },
              {
                type: "commercial",
                usableArea: "96.50",
                orientations: ["S", "E"],
                perSqm: 230_000,
              },
            ],
          },
          ...repeat(range(1, 7), olivApartments),
          {
            floor: 8,
            units: [
              {
                type: "apartment",
                typology: "F5",
                isDuplex: true,
                livingArea: "165.30",
                usableArea: "154.80",
                outdoorArea: "38.00",
                orientations: ["S", "E"],
                perSqm: 165_000,
              },
              {
                type: "apartment",
                typology: "F5",
                isDuplex: true,
                livingArea: "171.80",
                usableArea: "160.20",
                outdoorArea: "41.50",
                orientations: ["S", "W"],
                perSqm: 165_000,
              },
            ],
          },
        ],
      },
      {
        code: "B",
        name: "Bloc B",
        lowestFloor: 0,
        topFloor: 8,
        floorPremiumBp: 150,
        floors: [
          {
            floor: 0,
            units: [
              { type: "commercial", usableArea: "64.00", orientations: ["W"], perSqm: 220_000 },
              {
                type: "commercial",
                usableArea: "70.20",
                orientations: ["W", "S"],
                perSqm: 220_000,
              },
            ],
          },
          ...repeat(range(1, 8), olivApartments),
        ],
      },
    ],
    priceListName: "Grille de lancement",
  },
  {
    project: {
      code: "CORN",
      name: "Les Terrasses de la Corniche",
      status: "planning",
      address: "Front de mer, Aïn Benian",
      wilaya: "16 - Alger",
      commune: "Aïn Benian",
      buildingPermitNumber: "PC 16/1422/2025",
      buildingPermitDate: "2025-11-20",
      launchedOn: "2026-09-01",
      plannedDeliveryOn: "2029-03-31",
      description: "Bloc unique R+10 face à la mer, bureaux au rez-de-chaussée, caves en sous-sol.",
    },
    buildings: [
      {
        code: "C",
        name: "Bloc C",
        lowestFloor: -1,
        topFloor: 10,
        floorPremiumBp: 200,
        floors: [
          {
            floor: -1,
            units: Array.from({ length: 4 }, (): UnitSpec => ({
              type: "storage",
              usableArea: "8.00",
              flat: 650_000,
            })),
          },
          {
            floor: 0,
            units: [
              { type: "office", usableArea: "110.00", orientations: ["S"], perSqm: 200_000 },
              { type: "office", usableArea: "104.50", orientations: ["S", "E"], perSqm: 200_000 },
            ],
          },
          ...repeat(range(1, 10), cornApartments),
        ],
      },
    ],
    priceListName: "Grille de pré-commercialisation",
  },
];

/** Launch price in centimes: area × price per m², floor premium, rounded to 10 000 DA. */
function launchPrice(spec: UnitSpec, floor: number, floorPremiumBp: number): bigint {
  if (spec.flat !== undefined) return BigInt(spec.flat) * DA;
  const area = spec.livingArea ?? spec.usableArea;
  if (!area || spec.perSqm === undefined) throw new Error("seed: unit without a price basis");
  const [whole = "0", fraction = ""] = area.split(".");
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const base = (BigInt(spec.perSqm) * DA * hundredths) / 100n;
  const premium = floor > 1 ? (floor - 1) * floorPremiumBp : 0;
  const step = 10_000n * DA;
  return ((adjustByBasisPoints(base, premium) + step / 2n) / step) * step;
}

const money = (amount: bigint) => toDecimalString(amount);

type SeededUnit = { unitId: string; buildingCode: string; type: UnitType; price: bigint };

/** Returns project ids (OLIV, CORN) and unit ids (A-03-02…) by code for the next seed steps. */
export async function seedInventory(actors: {
  owner: TenantCtx;
  salesManager: TenantCtx;
}): Promise<{ projectIds: Map<string, string>; unitIds: Map<string, string> }> {
  const { owner, salesManager } = actors;
  const projectIds = new Map<string, string>();
  /** Current list price of every seeded unit, by code, per project. */
  const units = new Map<string, Map<string, SeededUnit>>();

  for (const spec of demoProjects) {
    const { id: projectId } = await createProject(owner, createProjectSchema.parse(spec.project));
    projectIds.set(spec.project.code, projectId);
    const projectUnits = new Map<string, SeededUnit>();
    units.set(spec.project.code, projectUnits);

    for (const b of spec.buildings) {
      const { id: buildingId } = await createBuilding(
        owner,
        createBuildingSchema.parse({
          projectId,
          code: b.code,
          name: b.name,
          lowestFloor: String(b.lowestFloor),
          topFloor: String(b.topFloor),
        }),
      );
      for (const { floor, units: floorUnits } of b.floors) {
        for (const [index, u] of floorUnits.entries()) {
          const code = defaultUnitCode(b.code, floor, index + 1);
          const { id: unitId } = await createUnit(
            salesManager,
            createUnitSchema.parse({
              buildingId,
              code,
              floor: String(floor),
              type: u.type,
              typology: u.typology,
              isDuplex: u.isDuplex ?? false,
              livingArea: u.livingArea,
              usableArea: u.usableArea,
              outdoorArea: u.outdoorArea,
              orientations: u.orientations ?? [],
            }),
          );
          projectUnits.set(code, {
            unitId,
            buildingCode: b.code,
            type: u.type,
            price: launchPrice(u, floor, b.floorPremiumBp),
          });
        }
      }
    }

    const { id: priceListId } = await createPriceList(
      salesManager,
      createPriceListSchema.parse({ projectId, name: spec.priceListName }),
    );
    await setPriceListItems(
      salesManager,
      setPriceListItemsSchema.parse({
        priceListId,
        items: [...projectUnits.values()].map((u) => ({ unitId: u.unitId, price: money(u.price) })),
      }),
    );
    await applyPriceList(salesManager, { priceListId });
  }

  const olivUnits = units.get("OLIV");
  const olivId = projectIds.get("OLIV");
  const unitIdOf = (code: string) => {
    for (const projectUnits of units.values()) {
      const found = projectUnits.get(code);
      if (found) return found.unitId;
    }
    throw new Error(`seed: unit ${code} missing`);
  };
  if (!olivUnits || !olivId) throw new Error("seed: project OLIV missing");

  // A negotiated adjustment outside any price list (shows in the unit's price history).
  const adjusted = olivUnits.get("A-08-02");
  if (!adjusted) throw new Error("seed: unit A-08-02 missing");
  adjusted.price = 30_380_000n * DA;
  await updateUnitPrice(
    salesManager,
    updateUnitPriceSchema.parse({
      unitId: adjusted.unitId,
      price: money(adjusted.price),
      reason: "Ajustement : vis-à-vis sur la terrasse",
    }),
  );

  for (const [code, reason] of [
    ["A-01-01", "Logement de fonction réservé au gérant"],
    ["B-00-01", "Local témoin : bureau de vente sur chantier"],
    ["C-10-04", "Terrasse en attente d'un permis modificatif"],
  ] as const) {
    await blockUnit(salesManager, unitStatusReasonSchema.parse({ unitId: unitIdOf(code), reason }));
  }

  // A draft revision, left unapplied: +4 % on the Bloc B apartments.
  const { id: draftId } = await createPriceList(
    salesManager,
    createPriceListSchema.parse({ projectId: olivId, name: "Révision 2027 : Bloc B +4 %" }),
  );
  await setPriceListItems(
    salesManager,
    setPriceListItemsSchema.parse({
      priceListId: draftId,
      items: [...olivUnits.values()].map((u) => ({
        unitId: u.unitId,
        price: money(
          u.buildingCode === "B" && u.type === "apartment"
            ? adjustByBasisPoints(u.price, 400)
            : u.price,
        ),
      })),
    }),
  );
  const unitIds = new Map<string, string>();
  for (const projectUnits of units.values()) {
    for (const [code, u] of projectUnits) unitIds.set(code, u.unitId);
  }
  return { projectIds, unitIds };
}
