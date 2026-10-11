import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  customRole,
  lease,
  member,
  memberCustomRole,
  portalLink,
  project,
  pushSubscription,
  reservation,
  reservationBuyer,
  residence,
  resident,
  unit,
} from "@/db/schema";
import { enqueueInTx } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { type Centimes, formatDZD } from "@/lib/money";
import {
  can,
  isGrantablePermission,
  isPortalOnly,
  type Permission,
  parseRoles,
} from "@/lib/permissions";
import type { PushKind, PushParam, PushParams } from "@/lib/push";
import { currentResident } from "@/server/residences/service";

/** Who caused the event (left out of its recipients); jobs have nobody. */
export type PushActor = { orgId: string; userId?: string | null };

type PushNotice = {
  /** Accounts to reach (members of the organization; the actor and duplicates are dropped). */
  userIds: readonly (string | null | undefined)[];
  params: PushParams;
  /** The page to open, without its locale (`/portal/sales/…`). */
  url: string;
};

/** Whether any member of the organization turned push notifications on (one query). */
async function anyDevice(tx: Tx, orgId: string): Promise<boolean> {
  // `member` has no RLS (Better Auth): always filter on the organization.
  const [row] = await tx
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .innerJoin(
      member,
      and(eq(member.userId, pushSubscription.userId), eq(member.organizationId, orgId)),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Queues one `push.send` per device of the accounts to reach, in the event's transaction: it
 * exists only if the event commits, and the worker sends it in the device's language. `build`
 * runs only when someone in the organization receives push notifications (otherwise the event
 * costs one query); it never blocks the event. Returns the number of devices queued.
 */
export async function queuePush(
  tx: Tx,
  actor: PushActor,
  kind: PushKind,
  build: () => Promise<PushNotice | null>,
): Promise<number> {
  if (!(await anyDevice(tx, actor.orgId))) return 0;
  const notice = await build();
  if (!notice) return 0;
  const userIds = [
    ...new Set(
      notice.userIds.filter((id): id is string => typeof id === "string" && id !== actor.userId),
    ),
  ];
  if (userIds.length === 0) return 0;
  const devices = await tx
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .innerJoin(
      member,
      and(eq(member.userId, pushSubscription.userId), eq(member.organizationId, actor.orgId)),
    )
    .where(inArray(pushSubscription.userId, userIds))
    .orderBy(asc(pushSubscription.createdAt));
  for (const device of devices) {
    await enqueueInTx(tx, "push.send", {
      organizationId: actor.orgId,
      subscriptionId: device.id,
      kind,
      params: notice.params,
      url: notice.url,
    });
  }
  return devices.length;
}

/** An amount in each language's format. */
export const pushAmount = (amount: Centimes): PushParam => ({
  fr: formatDZD(amount, "fr"),
  ar: formatDZD(amount, "ar"),
});

/** Portal accounts with a live link to one of these buyer files or resident records. */
async function linkedAccounts(
  tx: Tx,
  target: { buyerIds?: string[]; residentIds?: string[] },
): Promise<string[]> {
  const buyerIds = target.buyerIds ?? [];
  const residentIds = target.residentIds ?? [];
  if (buyerIds.length === 0 && residentIds.length === 0) return [];
  const rows = await tx
    .select({ userId: portalLink.userId })
    .from(portalLink)
    .where(
      and(
        isNull(portalLink.revokedAt),
        isNotNull(portalLink.userId),
        or(
          buyerIds.length > 0 ? inArray(portalLink.buyerId, buyerIds) : undefined,
          residentIds.length > 0 ? inArray(portalLink.residentId, residentIds) : undefined,
        ),
      ),
    );
  return rows.flatMap((r) => (r.userId ? [r.userId] : []));
}

/** The portal accounts of a sale's buyer files. */
export async function saleAccounts(tx: Tx, saleId: string) {
  const buyers = await tx
    .select({ id: reservationBuyer.buyerId })
    .from(reservationBuyer)
    .where(eq(reservationBuyer.reservationId, saleId));
  return linkedAccounts(tx, { buyerIds: buyers.map((b) => b.id) });
}

/** The portal accounts of a resident record (a ticket's reporter). */
export const residentAccounts = (tx: Tx, residentId: string) =>
  linkedAccounts(tx, { residentIds: [residentId] });

/** The unit and project of a sale (« lot {unit} ({place}) » in the texts). */
export async function saleObject(tx: Tx, saleId: string) {
  const [row] = await tx
    .select({ unit: unit.code, place: project.name })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(reservation.id, saleId));
  return { unit: row?.unit ?? "", place: row?.place ?? "" };
}

/** A sale's event, to the portal accounts of its buyer files (their sale's page). */
export function pushToSale(
  tx: Tx,
  actor: PushActor,
  kind: PushKind,
  saleId: string,
  params: (sale: { unit: string; place: string }) => PushParams,
) {
  return queuePush(tx, actor, kind, async () => {
    return {
      userIds: await saleAccounts(tx, saleId),
      params: params(await saleObject(tx, saleId)),
      url: `/portal/sales/${saleId}`,
    };
  });
}

/** A unit's charges event, to the portal accounts of its current co-owners (its account). */
export function pushToUnit(
  tx: Tx,
  actor: PushActor,
  kind: PushKind,
  target: { residenceId: string; unitId: string },
  params: (unit: { unit: string; place: string }) => PushParams,
) {
  return queuePush(tx, actor, kind, async () => {
    const coOwners = await tx
      .select({ id: resident.id })
      .from(resident)
      .where(
        and(
          eq(resident.residenceId, target.residenceId),
          eq(resident.unitId, target.unitId),
          eq(resident.kind, "co_owner"),
          currentResident(todayInAlgiers()),
        ),
      );
    const [row] = await tx
      .select({ unit: unit.code, place: residence.name })
      .from(residence)
      .innerJoin(unit, eq(unit.id, target.unitId))
      .where(eq(residence.id, target.residenceId));
    return {
      userIds: await linkedAccounts(tx, { residentIds: coOwners.map((r) => r.id) }),
      params: params({ unit: row?.unit ?? "", place: row?.place ?? "" }),
      url: `/portal/units/${target.unitId}`,
    };
  });
}

/** A lease's event, to the portal account of its tenant (its occupant record). */
export function pushToLease(
  tx: Tx,
  actor: PushActor,
  kind: PushKind,
  leaseId: string,
  params: (lease: { lease: string; unit: string }) => PushParams,
) {
  return queuePush(tx, actor, kind, async () => {
    const [row] = await tx
      .select({ number: lease.number, occupantId: lease.occupantId, unit: unit.code })
      .from(lease)
      .innerJoin(unit, eq(unit.id, lease.unitId))
      .where(eq(lease.id, leaseId));
    if (!row?.occupantId) return null;
    return {
      userIds: await linkedAccounts(tx, { residentIds: [row.occupantId] }),
      params: params({ lease: row.number, unit: row.unit }),
      url: `/portal/leases/${leaseId}`,
    };
  });
}

/** A residence's event, to its current residents' accounts (co-owners only if so). */
export function pushToResidence(
  tx: Tx,
  actor: PushActor,
  kind: PushKind,
  target: { residenceId: string; coOwnersOnly: boolean; url: string },
  params: (residence: { residence: string }) => PushParams,
) {
  return queuePush(tx, actor, kind, async () => {
    const residents = await tx
      .select({ id: resident.id })
      .from(resident)
      .where(
        and(
          eq(resident.residenceId, target.residenceId),
          target.coOwnersOnly ? eq(resident.kind, "co_owner") : undefined,
          currentResident(todayInAlgiers()),
        ),
      );
    const [row] = await tx
      .select({ name: residence.name })
      .from(residence)
      .where(eq(residence.id, target.residenceId));
    return {
      userIds: await linkedAccounts(tx, { residentIds: residents.map((r) => r.id) }),
      params: params({ residence: row?.name ?? "" }),
      url: target.url,
    };
  });
}

/**
 * Staff members holding every one of these permissions (their roles, or their custom role's
 * exact permissions); portal accounts never.
 */
export async function staffWith(tx: Tx, orgId: string, permissions: Permission[]) {
  const rows = await tx
    .select({ userId: member.userId, role: member.role, permissions: customRole.permissions })
    .from(member)
    .leftJoin(
      memberCustomRole,
      and(eq(memberCustomRole.organizationId, orgId), eq(memberCustomRole.userId, member.userId)),
    )
    .leftJoin(
      customRole,
      and(eq(customRole.id, memberCustomRole.customRoleId), isNull(customRole.archivedAt)),
    )
    .where(eq(member.organizationId, orgId));
  return rows
    .filter((row) => {
      const roles = parseRoles(row.role);
      if (isPortalOnly(roles)) return false;
      const custom = row.permissions ? row.permissions.filter(isGrantablePermission) : null;
      return permissions.every((p) => can({ roles, permissions: custom }, p));
    })
    .map((row) => row.userId);
}
