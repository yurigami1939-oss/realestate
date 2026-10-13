import { randomUUID } from "node:crypto";

import { sniffContentType } from "@/lib/files";
import { AppError } from "@/lib/result";
import { setOperatorLogo } from "@/server/console/billing";
import { getOperatorCtx } from "@/server/console/guard";
import { putObject } from "@/server/files/storage";
import { assertSameOrigin, jsonResult, readFormData } from "@/server/route-handler";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The operator's logo (CLAUDE.console.md §11), printed on the invoices issued afterwards:
 * multipart `file` (PNG or JPEG by its bytes, 2 MB), stored outside the tenants' prefix; an
 * empty `file` removes it. Operators only.
 */
export async function POST(request: Request) {
  return jsonResult(async () => {
    assertSameOrigin(request);
    const operator = await getOperatorCtx();
    const form = await readFormData(request, LOGO_MAX_BYTES + 64 * 1024);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      await setOperatorLogo(operator, null);
      return { logoKey: null };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffContentType(bytes);
    if (bytes.byteLength > LOGO_MAX_BYTES || (type !== "image/png" && type !== "image/jpeg")) {
      throw new AppError("VALIDATION", "console.errors.logo", {
        fieldErrors: { file: ["console.errors.logo"] },
      });
    }
    const key = `console/operator/logo-${randomUUID()}.${type === "image/png" ? "png" : "jpg"}`;
    await putObject(key, bytes, type);
    await setOperatorLogo(operator, key);
    return { logoKey: key };
  });
}
