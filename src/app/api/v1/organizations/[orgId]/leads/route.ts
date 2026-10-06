import { AppError } from "@/lib/result";
import { isUuid } from "@/lib/ids";
import { captureLead } from "@/server/crm/capture";
import { capturedLeadSchema } from "@/server/crm/schemas";
import { jsonResult } from "@/server/route-handler";

/** Accepted names of each field (websites, Zapier / Make, Facebook Lead Ads exports). */
const aliases: Record<string, string[]> = {
  fullName: ["fullName", "full_name", "name", "nom", "nom_complet"],
  phone: ["phone", "phone_number", "telephone", "téléphone", "tel", "mobile"],
  email: ["email", "e-mail", "mail"],
  city: ["city", "ville"],
  source: ["source"],
  project: ["project", "projet"],
  message: ["message", "comments", "commentaire"],
  sourceDetail: ["sourceDetail", "campaign", "campagne", "form_name", "form"],
};

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Lead capture (CLAUDE.md §7 CRM): `Authorization: Bearer lck_…`, a JSON or form-encoded body
 * with at least a name and a phone. Server to server only (the key must stay secret).
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/organizations/[orgId]/leads">,
) {
  return jsonResult(async () => {
    const { orgId } = await params;
    if (!isUuid(orgId)) throw new AppError("NOT_FOUND");
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION");
    const contentType = request.headers.get("content-type") ?? "";
    let body: Record<string, unknown> = {};
    try {
      body = contentType.includes("application/json")
        ? (JSON.parse(text) as Record<string, unknown>)
        : Object.fromEntries(new URLSearchParams(text));
    } catch {
      throw new AppError("VALIDATION");
    }
    const pick = (field: string) => {
      for (const name of aliases[field] ?? []) {
        const value = body[name];
        if (typeof value === "string" && value.trim() !== "") return value;
      }
      return undefined;
    };
    const parsed = capturedLeadSchema.safeParse(
      Object.fromEntries(Object.keys(aliases).map((field) => [field, pick(field)])),
    );
    if (!parsed.success) throw new AppError("VALIDATION", "capture.errors.invalid");
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    return captureLead(orgId, bearer, parsed.data);
  });
}
