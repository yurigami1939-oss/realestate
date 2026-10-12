/**
 * `pnpm demo:reset`: the demo deployment's nightly reset (CLAUDE.console.md §13) — empties its
 * bucket, drops and migrates its database, seeds it again. Refused unless DEMO_MODE=true and
 * DEMO_RESET=1. The worker is stopped before and started again after (it uses the jobs schema).
 */
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { pool } from "@/db/client";
import { consolePool } from "@/db/console-client";
import { rebuildDatabase } from "@/db/reset";
import { assertLocalDatabase, isDemoReset, seedDemo } from "@/db/seed";
import { stopEnqueue } from "@/jobs/enqueue";
import { bucket, s3, waitForBucket } from "@/server/files/s3";

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_URL are required");
if (!isDemoReset(process.env)) throw new Error("demo:reset needs DEMO_MODE=true and DEMO_RESET=1");
assertLocalDatabase(appUrl);

// Yesterday's files (documents, photos): the demo's bucket holds nothing else.
await waitForBucket();
let removed = 0;
for (;;) {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));
  const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
  if (keys.length === 0) break;
  const result = await s3.send(
    new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
  );
  const [failed] = result.Errors ?? [];
  if (failed) throw new Error(`demo:reset could not delete ${failed.Key}: ${failed.Message}`);
  removed += keys.length;
}

await rebuildDatabase({ ownerUrl, appUrl });
await seedDemo();
await stopEnqueue();
await pool.end();
await consolePool.end();
console.log(`Demo reset: ${removed} files removed, database migrated and seeded.`);
