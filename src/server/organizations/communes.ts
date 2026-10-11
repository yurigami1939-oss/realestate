import "server-only";

import { and, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { buyer, project, residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { wilayaCode } from "@/lib/wilayas";
import type { TenantCtx } from "@/server/auth/session";

/** At most this many communes are suggested. */
const MAX_COMMUNES = 1_000;

export type CommuneSuggestion = { commune: string; wilaya: string | null };

/**
 * The communes the organization's records already name (projects, buyer files, residences),
 * each once in its most used spelling, with its wilaya's code when known — suggested in the
 * address fields so the same commune is spelled the same way (CLAUDE.md §6: still free text).
 * Any member may read them.
 */
export async function listCommunes(ctx: TenantCtx): Promise<CommuneSuggestion[]> {
  return withTenant(ctx, async (tx) => {
    const sources = [
      {
        commune: project.commune,
        wilaya: project.wilaya,
        table: project,
        deleted: project.deletedAt,
      },
      { commune: buyer.commune, wilaya: buyer.wilaya, table: buyer, deleted: buyer.deletedAt },
      {
        commune: residence.commune,
        wilaya: residence.wilaya,
        table: residence,
        deleted: residence.deletedAt,
      },
    ] as const;
    const counts = new Map<string, { spellings: Map<string, number>; wilaya: string | null }>();
    for (const source of sources) {
      const rows = await tx
        .select({
          commune: sql<string>`trim(${source.commune})`,
          wilaya: source.wilaya,
          n: sql<number>`count(*)::int`,
        })
        .from(source.table)
        .where(and(isNull(source.deleted), isNotNull(source.commune), ne(source.commune, "")))
        .groupBy(sql`1`, source.wilaya);
      for (const row of rows) {
        const key = row.commune.toLocaleLowerCase("fr");
        const entry = counts.get(key) ?? { spellings: new Map(), wilaya: null };
        entry.spellings.set(row.commune, (entry.spellings.get(row.commune) ?? 0) + row.n);
        entry.wilaya ??= wilayaCode(row.wilaya);
        counts.set(key, entry);
      }
    }
    return [...counts.values()]
      .map((entry) => {
        const ranked = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1]);
        const total = ranked.reduce((sum, [, n]) => sum + n, 0);
        return { commune: ranked[0]?.[0] ?? "", wilaya: entry.wilaya, total };
      })
      .sort((a, b) => b.total - a.total || a.commune.localeCompare(b.commune, "fr"))
      .slice(0, MAX_COMMUNES)
      .map(({ commune, wilaya }) => ({ commune, wilaya }));
  });
}
