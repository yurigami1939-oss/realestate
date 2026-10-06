/** Isomorphic: requests sent from the portal and their handling (CLAUDE.md §7 Portal). */
import { z } from "zod";

import { portalRequestKinds, portalRequestStatuses, requestableCertificates } from "@/lib/requests";
import { optionalDateText, optionalText } from "@/lib/zod";

/** A buyer's request about one of their sales. */
export const createPortalRequestSchema = z
  .object({
    reservationId: z.uuid(),
    kind: z.enum(portalRequestKinds),
    certificateKind: z.enum(requestableCertificates).or(z.literal("")).optional(),
    preferredOn: optionalDateText(),
    message: optionalText(1000),
  })
  .superRefine((r, ctx) => {
    if (r.kind === "certificate" && !r.certificateKind) {
      ctx.addIssue({ code: "custom", path: ["certificateKind"], message: "validation.required" });
    }
    if (r.kind !== "certificate" && !r.message) {
      ctx.addIssue({ code: "custom", path: ["message"], message: "validation.required" });
    }
  })
  .transform((r) => ({
    ...r,
    certificateKind: r.kind === "certificate" && r.certificateKind ? r.certificateKind : null,
    preferredOn: r.kind === "appointment" ? r.preferredOn : null,
  }));

/** Staff close a request: done, or declined with an answer. */
export const closePortalRequestSchema = z.object({
  requestId: z.uuid(),
  outcome: z.enum(["done", "declined"]),
  answer: optionalText(1000),
});

export const REQUESTS_PAGE_SIZE = 50;

export const requestListParams = z.object({
  status: z.enum([...portalRequestStatuses, "all"]).catch("open"),
  page: z.coerce.number().int().min(1).catch(1),
});
export type RequestListParams = z.output<typeof requestListParams>;
