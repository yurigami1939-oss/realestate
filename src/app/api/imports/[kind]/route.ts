import { revalidatePath } from "next/cache";

import { getTenantCtx } from "@/server/auth/session";
import { importKinds, importOptionsSchema, MAX_IMPORT_BYTES } from "@/server/imports/schemas";
import { runImport } from "@/server/imports/service";
import { assertSameOrigin, jsonResult, readFormData } from "@/server/route-handler";
import { AppError } from "@/lib/result";

/**
 * Data import (CLAUDE.md §7 Imports): multipart `file` (.xlsx) with `project` / `residence` and
 * `commit` = 1 to write; answers the report (counts, blocking issues, rows left aside).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/imports/[kind]">) {
  const { kind } = await params;
  return jsonResult(async () => {
    if (!(importKinds as readonly string[]).includes(kind)) throw new AppError("NOT_FOUND");
    assertSameOrigin(request);
    const ctx = await getTenantCtx();
    const form = await readFormData(request, MAX_IMPORT_BYTES);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("VALIDATION", "imports.errors.noFile");
    }
    const options = importOptionsSchema.parse({
      project: form.get("project") ?? undefined,
      residence: form.get("residence") ?? undefined,
      commit: form.get("commit") ?? undefined,
    });
    const report = await runImport(
      ctx,
      kind as (typeof importKinds)[number],
      Buffer.from(await file.arrayBuffer()),
      { projectId: options.project, residenceId: options.residence, commit: options.commit },
    );
    if (report.committed) {
      for (const path of ["projects", "buyers", "sales", "residences"]) {
        revalidatePath(`/[locale]/${path}`, "layout");
      }
    }
    return report;
  });
}
