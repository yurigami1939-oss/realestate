import "server-only";

import { eq } from "drizzle-orm";

import { member, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { enqueueInTx } from "@/jobs/enqueue";
import { parseRoles } from "@/lib/permissions";
import { rentsDigestEmail } from "@/server/email/templates";
import { loadCompanyProfile } from "@/server/organizations/settings";

import { loadEndingLeases, loadOverdueRents } from "./queries";

/** Roles that receive the daily rentals digest (CLAUDE.md §12). */
const digestRoles = new Set(["property_manager", "cashier"]);

/** Leases flagged in the digest this many days before their term. */
const DIGEST_ENDING_DAYS = 30;

/**
 * Daily `reminders.digest` job, rentals part: e-mails the overdue rents and the leases ending
 * within 30 days (or past their term) to the property managers and cashiers — nothing when
 * there is nothing to report — at most once a day per recipient. Returns the e-mails queued.
 */
export async function sendRentsDigest(organizationId: string, date: string): Promise<number> {
  return withTenant({ orgId: organizationId }, async (tx) => {
    const overdue = await loadOverdueRents(tx, date);
    const ending = await loadEndingLeases(tx, date, DIGEST_ENDING_DAYS);
    if (overdue.length === 0 && ending.length === 0) return 0;
    // `member` has no RLS (Better Auth): always filter on the organization.
    const members = await tx
      .select({ email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId));
    const recipients = [
      ...new Set(
        members
          .filter((m) => parseRoles(m.role).some((role) => digestRoles.has(role)))
          .map((m) => m.email),
      ),
    ];
    const company = await loadCompanyProfile(tx, organizationId);
    for (const to of recipients) {
      await enqueueInTx(
        tx,
        "email.send",
        rentsDigestEmail({
          to,
          organization: company.name,
          date,
          overdue,
          ending,
          url: `${env.BETTER_AUTH_URL}/fr/rentals/overdue`,
        }),
        { singletonKey: `rents-digest:${organizationId}:${to}`, singletonSeconds: 86_400 },
      );
    }
    return recipients.length;
  });
}
