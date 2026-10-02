import "server-only";

import { and, eq, isNull, type SQL } from "drizzle-orm";

import type { Tx } from "@/db/client";
import { lead, member, project, unit } from "@/db/schema";
import { can, parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import type { TenantCtx } from "@/server/auth/session";

/** Managers see every lead; a commercial sees the leads assigned to them (CLAUDE.md §12). */
export const seesAllLeads = (ctx: Pick<TenantCtx, "roles">) => can(ctx.roles, "lead:read_all");

/** Extra WHERE condition limiting leads to what `ctx` may see (undefined = no limit). */
export function visibleLeads(ctx: TenantCtx): SQL | undefined {
  return seesAllLeads(ctx) ? undefined : eq(lead.assignedTo, ctx.userId);
}

/** A live lead the member may see, locked for update when asked; NOT_FOUND otherwise. */
export async function loadVisibleLead(
  tx: Tx,
  ctx: TenantCtx,
  leadId: string,
  options: { forUpdate?: boolean } = {},
) {
  const query = tx
    .select()
    .from(lead)
    .where(and(eq(lead.id, leadId), isNull(lead.deletedAt), visibleLeads(ctx)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** Leads can only be assigned to members who work leads (commercials and managers). */
export async function assertLeadOwner(tx: Tx, orgId: string, userId: string, field: string) {
  // `member` is scoped by Better Auth, not RLS: filter on the organization explicitly.
  const [row] = await tx
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  if (!row || !can(parseRoles(row.role), "lead:read")) {
    throw invalid(field, "crm.errors.notAssignable");
  }
}

export async function assertLiveProject(tx: Tx, projectId: string, field = "projectId") {
  const [row] = await tx
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)));
  if (!row) throw invalid(field, "crm.errors.projectNotFound");
}

export async function assertLiveUnit(tx: Tx, unitId: string, projectId: string | null) {
  const [row] = await tx
    .select({ projectId: unit.projectId })
    .from(unit)
    .where(and(eq(unit.id, unitId), isNull(unit.deletedAt)));
  if (!row || (projectId !== null && row.projectId !== projectId)) {
    throw invalid("unitId", "crm.errors.unitNotFound");
  }
  return row;
}
