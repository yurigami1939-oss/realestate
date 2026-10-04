import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createChargeCategory } from "@/server/charges/categories";
import { createChargeCategorySchema } from "@/server/charges/schemas";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getAttendanceMonth, monthDays, saveAttendance } from "./attendance";
import { getStaffMember, listStaff } from "./queries";
import {
  createStaffSchema,
  endStaffSchema,
  recordAdvanceSchema,
  saveAttendanceSchema,
  updateStaffSchema,
} from "./schemas";
import { createStaff, deleteAdvance, endStaff, recordAdvance, updateStaff } from "./service";

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
      chargeFrequency: "monthly",
      reserveFund: "0",
      callDueDays: "15",
    }),
  );
  const { id: categoryId } = await createChargeCategory(
    manager,
    createChargeCategorySchema.parse({
      residenceId,
      name: "Gardiennage",
      key: "equal",
      weighting: "share",
      buildingId: "",
      unitIds: [],
    }),
  );
  return { team, manager, residenceId, categoryId };
}

const staffInput = (
  residenceId: string,
  categoryId: string,
  overrides: Record<string, string> = {},
) =>
  createStaffSchema.parse({
    residenceId,
    role: "security",
    lastName: "Mansouri",
    firstName: "Ali",
    phone: "0661 22 33 44",
    nin: "",
    hiredOn: "2026-01-01",
    monthlySalary: "45 000",
    categoryId,
    notes: "",
    ...overrides,
  });

describe("residence staff", () => {
  it("are kept with their salary, departure and advances", async () => {
    const { team, manager, residenceId, categoryId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const accountant = await addMember(team.orgId, ["accountant"]);

    await expect(createStaff(cashier, staffInput(residenceId, categoryId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const other = await scenario();
    await expect(
      createStaff(manager, staffInput(residenceId, other.categoryId)),
    ).rejects.toMatchObject({ messageKey: "charges.errors.categoryNotFound" });

    const { id: guard } = await createStaff(manager, staffInput(residenceId, categoryId));
    const { id: cleaner } = await createStaff(
      accountant,
      staffInput(residenceId, "", { role: "cleaning", lastName: "Haddad", firstName: "Nadia" }),
    );
    await updateStaff(
      manager,
      updateStaffSchema.parse({
        staffId: guard,
        role: "security",
        lastName: "Mansouri",
        firstName: "Ali",
        hiredOn: "2026-01-01",
        monthlySalary: "48 000",
        categoryId,
      }),
    );
    await expect(
      endStaff(manager, endStaffSchema.parse({ staffId: cleaner, leftOn: "2025-12-31" })),
    ).rejects.toMatchObject({ messageKey: "staff.errors.leftBeforeHired" });
    await endStaff(manager, endStaffSchema.parse({ staffId: cleaner, leftOn: "2026-03-31" }));

    expect(
      (await listStaff(accountant, residenceId)).map((s) => [
        s.lastName,
        s.employed,
        s.monthlySalary,
        s.categoryName,
      ]),
    ).toEqual([
      ["Mansouri", true, 48_000_00n, "Gardiennage"],
      ["Haddad", false, 45_000_00n, null],
    ]);

    const advance = (staffId: string, overrides: Record<string, string> = {}) =>
      recordAdvanceSchema.parse({
        staffId,
        paidOn: today,
        month: today.slice(0, 7),
        amount: "10 000",
        notes: "",
        ...overrides,
      });
    expect(() => advance(guard, { month: "2026-13" })).toThrow();
    await expect(
      recordAdvance(manager, advance(guard, { paidOn: addDays(today, 1) })),
    ).rejects.toMatchObject({ messageKey: "charges.errors.futureDate" });
    await expect(recordAdvance(manager, advance(cleaner))).rejects.toMatchObject({
      messageKey: "staff.errors.notEmployed",
    });
    const { id: kept } = await recordAdvance(manager, advance(guard));
    const { id: mistake } = await recordAdvance(manager, advance(guard, { amount: "1" }));
    await deleteAdvance(manager, mistake);

    const sheet = await getStaffMember(accountant, residenceId, guard);
    expect(sheet?.advances).toMatchObject([
      { id: kept, amount: 10_000_00n, month: `${today.slice(0, 7)}-01` },
    ]);
    expect(await getStaffMember(accountant, residenceId, "not-a-uuid")).toBeNull();

    const audit = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "staff_member"), eq(auditLog.entityId, guard))),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "salary_advance.create",
      "salary_advance.create",
      "salary_advance.delete",
      "staff_member.create",
      "staff_member.update",
    ]);
  });
});

describe("attendance", () => {
  it("is saved month by month within each agent's employment", async () => {
    const { team, manager, residenceId, categoryId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: guard } = await createStaff(manager, staffInput(residenceId, categoryId));
    const { id: cleaner } = await createStaff(
      manager,
      staffInput(residenceId, "", { role: "cleaning", lastName: "Haddad", firstName: "Nadia" }),
    );
    await endStaff(manager, endStaffSchema.parse({ staffId: cleaner, leftOn: "2026-03-31" }));

    expect(monthDays("2026-02-01")).toHaveLength(28);
    const save = (month: string, marks: { staffId: string; day: string; status: string }[]) =>
      saveAttendanceSchema.parse({ residenceId, month, marks });
    await expect(saveAttendance(cashier, save("2026-03", []))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveAttendance(
        manager,
        save("2026-03", [{ staffId: guard, day: "2026-04-01", status: "absent" }]),
      ),
    ).rejects.toMatchObject({ messageKey: "staff.errors.attendanceOutOfMonth" });
    // The cleaner left at the end of March: not on April's sheet.
    await expect(
      saveAttendance(
        manager,
        save("2026-04", [{ staffId: cleaner, day: "2026-04-02", status: "absent" }]),
      ),
    ).rejects.toMatchObject({ messageKey: "staff.errors.attendanceOutOfMonth" });

    await saveAttendance(
      manager,
      save("2026-03", [
        { staffId: guard, day: "2026-03-10", status: "absent" },
        { staffId: guard, day: "2026-03-11", status: "leave" },
        { staffId: cleaner, day: "2026-03-31", status: "sick" },
      ]),
    );
    let sheet = await getAttendanceMonth(manager, residenceId, "2026-03-01");
    expect(sheet?.staff.map((a) => a.lastName)).toEqual(["Haddad", "Mansouri"]);
    expect(sheet?.marks).toHaveLength(3);

    // Saved as a whole: the month's marks are replaced.
    await saveAttendance(
      manager,
      save("2026-03", [{ staffId: guard, day: "2026-03-12", status: "off" }]),
    );
    sheet = await getAttendanceMonth(manager, residenceId, "2026-03-01");
    expect(sheet?.marks).toEqual([{ staffId: guard, day: "2026-03-12", status: "off" }]);
    expect((await getAttendanceMonth(manager, residenceId, "2026-04-01"))?.staff).toHaveLength(1);
  });
});
