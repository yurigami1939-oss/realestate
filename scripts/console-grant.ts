/**
 * `pnpm console:grant <email>` (owner connection): makes an existing user an operator of the
 * console (CLAUDE.console.md §9). Refuses a member of any organization: operators are never
 * tenant members. No screen grants this right. The operator then enrols in two-factor
 * authentication on /console/security before anything else.
 */
import { Pool } from "pg";

const email = process.argv[2]?.trim().toLowerCase();
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!email) throw new Error("Usage: pnpm console:grant <email>");
if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is required");

const pool = new Pool({ connectionString: ownerUrl, max: 1 });
try {
  const { rows } = await pool.query<{ id: string; role: string | null }>(
    `select id, role from "user" where lower(email) = $1`,
    [email],
  );
  const [found] = rows;
  if (!found) throw new Error(`No user with the e-mail ${email}: create the account first.`);
  const { rows: memberships } = await pool.query<{ n: number }>(
    `select count(*)::int as n from member where user_id = $1`,
    [found.id],
  );
  if ((memberships[0]?.n ?? 0) > 0) {
    throw new Error(`${email} is a member of an organization: operators never are.`);
  }
  await pool.query(`update "user" set role = 'operator' where id = $1`, [found.id]);
  console.log(`${email} is now an operator (two-factor enrolment on /console/security).`);
} finally {
  await pool.end();
}
