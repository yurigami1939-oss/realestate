import { and, eq } from "drizzle-orm";
import readXlsxFile from "read-excel-file/node";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, payment, receipt, reservation, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { listSalePayments } from "@/server/payments/queries";
import { getResidence, listUnitResidents } from "@/server/residences/queries";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";
import { getSale } from "@/server/sales/sale-queries";
import { type ExportValue, buildWorkbook } from "@/server/exports/xlsx";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { runImport } from "./service";
import { buildTemplate } from "./templates";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
/** dd/mm/yyyy, as typed in Excel. */
const typed = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** A workbook of text sheets: { name: [headers, ...rows] }. */
const workbook = (sheets: Record<string, ExportValue[][]>) =>
  buildWorkbook(
    Object.entries(sheets).map(([name, [headers = [], ...rows]]) => ({
      name,
      columns: headers.map((h) => ({ header: String(h) })),
      rows,
    })),
    { rightToLeft: false },
  );

async function scenario() {
  const team = await createSalesTeam();
  const setup = await createSaleSetup(team);
  return { team, ...setup };
}

describe("data import", () => {
  it("builds templates in the member's language with a help sheet", async () => {
    const { file, bytes } = await buildTemplate("sales", "ar");
    expect(file).toBe("modele-ventes.xlsx");
    const sheets = await readXlsxFile(bytes);
    expect(sheets.map((s) => s.sheet)).toEqual(["المبيعات", "جدول الأقساط", "المدفوعات", "مساعدة"]);
    expect(sheets[0]?.data[0]?.[0]).toBe("مرجع البيع");
    // The help sheet lists every column with its explanation.
    expect(sheets[3]?.data.length).toBeGreaterThan(30);
  });

  it("checks units first, then creates them priced and blocked, all or nothing", async () => {
    const { team, projectId } = await scenario();
    const units = (rows: ExportValue[][]) =>
      workbook({
        Lots: [
          [
            "Bâtiment",
            "Code lot",
            "Étage",
            "Type",
            "Typologie",
            "Surface habitable (m²)",
            "Prix (DA)",
            "Bloqué (motif)",
          ],
          ...rows,
        ],
      });
    const bad = await units([
      ["A", "A-01-01", 1, "Appartement", "F3", 86.75, 12_500_000, ""],
      ["Z", "Z-01-01", 1, "", "F2", 60, "", ""],
      ["A", "A-09-01", 9, "", "F2", 60, "", ""],
      ["A", "A-03-01", 3, "", "F3", 86.75, "", ""],
    ]);
    const checked = await runImport(team.owner, "units", bad, { projectId, commit: true });
    expect(checked.committed).toBe(false);
    expect(checked.issues.map((i) => [i.row, i.messageKey])).toEqual([
      [3, "imports.errors.buildingNotFound"],
      [4, "imports.errors.floorOutOfRange"],
    ]);
    // A-03-01 already exists (fixture): left aside, not blocking.
    expect(checked.warnings.map((w) => w.messageKey)).toEqual(["imports.warnings.unitExists"]);

    const good = await units([
      ["A", "A-01-01", 1, "Appartement", "F3", 86.75, "12 500 000", ""],
      ["a", "A-00-01", "RDC", "Local", "", "", 9_000_000, "Gardé par la société"],
      ["A", "A-03-01", 3, "", "F3", 86.75, "", ""],
    ]);
    await expect(
      runImport(team.agentA, "units", good, { projectId, commit: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const done = await runImport(team.owner, "units", good, { projectId, commit: true });
    expect(done).toMatchObject({ committed: true, counts: { units: 2 }, issues: [] });
    const rows = await withTenant(team.owner, (tx) =>
      tx
        .select({ code: unit.code, status: unit.status, price: unit.listPrice, type: unit.type })
        .from(unit)
        .where(eq(unit.projectId, projectId)),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { code: "A-01-01", status: "available", price: 12_500_000_00n, type: "apartment" },
        { code: "A-00-01", status: "blocked", price: 9_000_000_00n, type: "commercial" },
      ]),
    );
    const audits = await withTenant(team.owner, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "organization.import")),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ kind: "units", counts: { units: 2 } });
  });

  it("imports buyers, then ongoing sales with their schedule and past payments", async () => {
    const { team } = await scenario();
    const accountant = await addMember(team.orgId, ["accountant"]);
    await createBuyer(
      team.owner,
      createBuyerSchema.parse({
        lastName: "Haddad",
        firstName: "Nadia",
        nin: "109870123456789099",
        phone: "0661 00 00 01",
        leadId: "",
      }),
    );
    const buyersFile = await workbook({
      Acquéreurs: [
        ["Civilité", "Nom", "Prénom", "NIN", "Téléphone", "WhatsApp"],
        ["M.", "Bensalem", "Karim", "109870123456789012", "0661501234", "oui"],
        ["Mme", "Cherif", "Amina", "", "0770 11 22 33", ""],
        ["Mme", "Haddad", "Nadia", "109870123456789099", "0661 00 00 01", ""],
      ],
    });
    const buyers = await runImport(team.owner, "buyers", buyersFile, { commit: true });
    expect(buyers).toMatchObject({ committed: true, counts: { buyers: 2 }, issues: [] });
    expect(buyers.warnings.map((w) => w.messageKey)).toEqual(["imports.warnings.buyerExists"]);

    const reservedOn = addDays(today, -400);
    const signedOn = addDays(today, -200);
    const salesFile = (secondPrice: number) =>
      workbook({
        Ventes: [
          [
            "Réf. vente",
            "Code projet",
            "Code lot",
            "Acquéreur",
            "Acquéreur 2",
            "Date de réservation",
            "Prix de vente (DA)",
            "Date VSP",
          ],
          [
            "V-17",
            "OLIV",
            "A-03-01",
            "109870123456789012",
            "0770112233",
            typed(reservedOn),
            13_010_000,
            "",
          ],
          [
            "V-18",
            "oliv",
            "A-03-02",
            "0661000001",
            "",
            typed(reservedOn),
            secondPrice,
            typed(signedOn),
          ],
        ],
        Échéancier: [
          ["Réf. vente", "N°", "Libellé", "Montant (DA)", "Échéance", "Étape"],
          ["V-17", 1, "Réservation", 2_602_000, typed(reservedOn), ""],
          ["V-17", 2, "Solde", 10_408_000, "", "Fondations"],
          ["V-18", 1, "Comptant", 13_010_000, typed(reservedOn), ""],
        ],
        Paiements: [
          ["Réf. vente", "Date", "Montant (DA)", "Mode", "N° reçu d'origine"],
          ["V-17", typed(reservedOn), 2_602_000, "Virement", "R-2024-0153"],
          ["V-18", typed(reservedOn), 13_010_000, "Chèque", "R-2024-0154"],
        ],
      });
    // One sale's schedule does not add up to its price: nothing is written.
    const refused = await runImport(team.owner, "sales", await salesFile(13_000_000), {
      commit: true,
    });
    expect(refused.committed).toBe(false);
    expect(refused.issues.map((i) => i.messageKey)).toEqual(
      expect.arrayContaining(["imports.errors.scheduleTotal", "imports.errors.paidAbovePrice"]),
    );
    expect(await withTenant(team.owner, (tx) => tx.select().from(reservation))).toHaveLength(0);

    await expect(
      runImport(accountant, "sales", await salesFile(13_010_000), { commit: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const done = await runImport(team.owner, "sales", await salesFile(13_010_000), {
      commit: true,
    });
    expect(done).toMatchObject({
      committed: true,
      counts: { sales: 2, installments: 3, payments: 2 },
      issues: [],
    });

    const sales = await withTenant(team.owner, (tx) =>
      tx
        .select({
          id: reservation.id,
          number: reservation.number,
          status: reservation.status,
          saleNumber: reservation.saleNumber,
          unitStatus: unit.status,
        })
        .from(reservation)
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .orderBy(reservation.number),
    );
    expect(sales).toHaveLength(2);
    const [open, sold] = [
      sales.find((s) => s.status === "reserved"),
      sales.find((s) => s.status === "sold"),
    ];
    expect(open?.unitStatus).toBe("reserved");
    expect(open?.number).toMatch(new RegExp(`^RES-${reservedOn.slice(0, 4)}-`));
    expect(sold).toMatchObject({ unitStatus: "sold" });
    expect(sold?.saleNumber).toMatch(new RegExp(`^VSP-${signedOn.slice(0, 4)}-`));

    const detail = await getSale(accountant, open?.id ?? "");
    expect(detail?.buyers.map((b) => b.lastName)).toEqual(["Bensalem", "Cherif"]);
    expect(detail?.statement.paid).toBe(2_602_000_00n);
    expect(detail?.installments.map((i) => [i.trigger, i.dueOn])).toEqual([
      ["signing", reservedOn],
      ["milestone", null],
    ]);
    // Imported payments keep the previous receipt number; no REC- receipt is issued.
    const paid = await listSalePayments(accountant, open?.id ?? "");
    expect(paid).toMatchObject([
      { imported: true, legacyReceipt: "R-2024-0153", receiptId: null, method: "bank_transfer" },
    ]);
    const receipts = await withTenant(team.owner, (tx) =>
      tx
        .select({ id: receipt.id })
        .from(receipt)
        .innerJoin(payment, eq(payment.id, receipt.paymentId))
        .where(eq(payment.imported, true)),
    );
    expect(receipts).toEqual([]);
    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "reservation.import"), eq(auditLog.entityId, open?.id ?? "")),
        ),
    );
    expect(audits[0]?.after).toMatchObject({ legacyRef: "V-17", payments: 1 });

    // The same file again: its units are no longer available.
    const again = await runImport(team.owner, "sales", await salesFile(13_010_000), {
      commit: false,
    });
    expect(again.issues.map((i) => i.messageKey)).toContain("imports.errors.unitNotAvailable");
  });

  it("imports co-owners, occupants and shares of a residence", async () => {
    const { team, projectId } = await scenario();
    const manager = await addMember(team.orgId, ["property_manager"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId,
        name: "Résidence Les Oliviers",
        address: "",
        commune: "Kouba",
        wilaya: "16 - Alger",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
        notes: "",
      }),
    );
    const file = await workbook({
      Copropriétaires: [
        ["Code lot", "Tantièmes", "Qualité", "Nom", "Prénom", "Téléphone", "Depuis le"],
        ["A-03-01", 350, "Copropriétaire", "Saïdi", "Yasmine", "0661 11 22 33", "01/09/2023"],
        ["A-03-01", 350, "Copropriétaire", "Saïdi", "Omar", "", ""],
        ["A-03-01", "", "Locataire", "Amrani", "Leila", "", ""],
        ["A-03-02", 400, "", "", "", "", ""],
        ["B-01-01", 100, "", "Inconnu", "", "", ""],
      ],
    });
    await expect(
      runImport(team.agentA, "residents", file, { residenceId, commit: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const checked = await runImport(manager, "residents", file, { residenceId, commit: true });
    expect(checked.committed).toBe(false);
    expect(checked.issues.map((i) => i.messageKey)).toEqual(["imports.errors.unitNotInResidence"]);

    const fixed = await workbook({
      Copropriétaires: [
        ["Code lot", "Tantièmes", "Qualité", "Nom", "Prénom", "Téléphone", "Depuis le"],
        ["A-03-01", 350, "Copropriétaire", "Saïdi", "Yasmine", "0661 11 22 33", "01/09/2023"],
        ["A-03-01", 350, "Copropriétaire", "Saïdi", "Omar", "", ""],
        ["A-03-01", "", "Locataire", "Amrani", "Leila", "", ""],
        ["A-03-02", 400, "", "", "", "", ""],
      ],
    });
    const done = await runImport(manager, "residents", fixed, { residenceId, commit: true });
    expect(done).toMatchObject({ committed: true, counts: { shares: 2, residents: 3 } });
    const home = await getResidence(manager, residenceId);
    const shares = Object.fromEntries(home?.units.map((u) => [u.code, u.share]) ?? []);
    expect(shares).toMatchObject({ "A-03-01": 350, "A-03-02": 400 });
    const unitId = home?.units.find((u) => u.code === "A-03-01")?.unitId ?? "";
    const people = await listUnitResidents(manager, residenceId, [unitId]);
    expect(people.map((p) => [p.kind, p.lastName, p.firstName, p.isMain]).sort()).toEqual(
      [
        ["co_owner", "Saïdi", "Omar", false],
        ["co_owner", "Saïdi", "Yasmine", true],
        ["occupant", "Amrani", "Leila", true],
      ].sort(),
    );

    // Imported again: everyone is already there.
    const again = await runImport(manager, "residents", fixed, { residenceId, commit: false });
    expect(again.counts.residents).toBe(0);
    expect(again.warnings).toHaveLength(3);
  });
});
