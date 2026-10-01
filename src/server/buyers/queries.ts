import "server-only";

import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { buyer, buyerDocument, file, lead, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { phoneSearchDigits } from "@/lib/phone";
import { buyerDocumentKinds, requiredBuyerDocuments } from "@/lib/sales";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { visibleBuyers } from "./access";
import { BUYERS_PAGE_SIZE, type BuyerListParams } from "./schemas";

const owner = alias(user, "owner");

/** Required documents still missing (no row, or status "missing"). */
const missingDocuments = sql<number>`(
  ${requiredBuyerDocuments.length} - (
    select count(*) from buyer_document d
    where d.buyer_id = ${buyer.id} and d.status <> 'missing'
      and d.kind in (${sql.join(
        requiredBuyerDocuments.map((k) => sql`${k}`),
        sql`, `,
      )})
  )
)::int`;

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const digits = phoneSearchDigits(q);
  return or(
    ilike(buyer.lastName, like),
    ilike(buyer.firstName, like),
    ilike(buyer.lastNameAr, like),
    ilike(buyer.nin, like),
    digits ? ilike(buyer.phone, `%${digits}%`) : undefined,
  );
}

/** One page of buyers, by name. */
export async function listBuyers(ctx: TenantCtx, params: BuyerListParams) {
  assertCan(ctx, "buyer:read");
  const page = params.page ?? 1;
  return withTenant(ctx, async (tx) => {
    const where = and(isNull(buyer.deletedAt), visibleBuyers(ctx), searchCondition(params.q));
    const rows = await tx
      .select({
        id: buyer.id,
        lastName: buyer.lastName,
        firstName: buyer.firstName,
        phone: buyer.phone,
        nin: buyer.nin,
        commune: buyer.commune,
        wilaya: buyer.wilaya,
        ownerName: owner.name,
        missingDocuments,
      })
      .from(buyer)
      .leftJoin(owner, eq(owner.id, buyer.ownerUserId))
      .where(where)
      .orderBy(asc(buyer.lastName), asc(buyer.firstName))
      .limit(BUYERS_PAGE_SIZE)
      .offset((page - 1) * BUYERS_PAGE_SIZE);
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(buyer)
      .where(where);
    return { rows, total: total?.n ?? 0, page, pageSize: BUYERS_PAGE_SIZE };
  });
}

export type BuyerListRow = Awaited<ReturnType<typeof listBuyers>>["rows"][number];

/** Buyer file: identity, lead, documents checklist (every kind, missing when no row). */
export async function getBuyer(ctx: TenantCtx, buyerId: string) {
  assertCan(ctx, "buyer:read");
  if (!isUuid(buyerId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ buyer, leadName: lead.fullName, ownerName: owner.name })
      .from(buyer)
      .leftJoin(lead, eq(lead.id, buyer.leadId))
      .leftJoin(owner, eq(owner.id, buyer.ownerUserId))
      .where(and(eq(buyer.id, buyerId), isNull(buyer.deletedAt), visibleBuyers(ctx)));
    if (!row) return null;
    const rows = await tx
      .select({
        kind: buyerDocument.kind,
        status: buyerDocument.status,
        note: buyerDocument.note,
        fileId: buyerDocument.fileId,
        fileName: file.fileName,
        updatedAt: buyerDocument.updatedAt,
      })
      .from(buyerDocument)
      .leftJoin(file, and(eq(file.id, buyerDocument.fileId), isNull(file.deletedAt)))
      .where(eq(buyerDocument.buyerId, buyerId));
    const documents = buyerDocumentKinds.map((kind) => {
      const found = rows.find((r) => r.kind === kind);
      return {
        kind,
        required: (requiredBuyerDocuments as readonly string[]).includes(kind),
        status: found?.status ?? ("missing" as const),
        note: found?.note ?? null,
        fileId: found?.fileName ? found.fileId : null,
        fileName: found?.fileName ?? null,
        updatedAt: found?.updatedAt ?? null,
      };
    });
    return {
      ...row.buyer,
      leadName: row.leadName,
      ownerName: row.ownerName,
      documents,
      missingRequired: documents.filter((d) => d.required && d.status === "missing").length,
    };
  });
}

export type BuyerDetail = NonNullable<Awaited<ReturnType<typeof getBuyer>>>;

/** Buyers already created from these leads (lead sheet: "fiche acquéreur" link). */
export async function listBuyersOfLead(ctx: TenantCtx, leadId: string) {
  assertCan(ctx, "buyer:read");
  if (!isUuid(leadId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: buyer.id, lastName: buyer.lastName, firstName: buyer.firstName })
      .from(buyer)
      .where(and(eq(buyer.leadId, leadId), isNull(buyer.deletedAt), visibleBuyers(ctx))),
  );
}

/** Buyers for selects (reservation form), optionally limited to some ids. */
export async function listBuyerOptions(ctx: TenantCtx, ids?: string[]) {
  assertCan(ctx, "buyer:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: buyer.id,
        lastName: buyer.lastName,
        firstName: buyer.firstName,
        phone: buyer.phone,
        leadId: buyer.leadId,
      })
      .from(buyer)
      .where(
        and(isNull(buyer.deletedAt), visibleBuyers(ctx), ids ? inArray(buyer.id, ids) : undefined),
      )
      .orderBy(asc(buyer.lastName), asc(buyer.firstName))
      .limit(1000),
  );
}
