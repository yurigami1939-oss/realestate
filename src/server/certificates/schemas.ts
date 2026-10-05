/** Isomorphic: certificates issued on a sale (CLAUDE.md §7 Certificates). */
import { z } from "zod";

import { certificateKinds } from "@/lib/certificates";
import { optionalText } from "@/lib/zod";

/** Staff: one certificate of a sale, optionally addressed to a bank or an administration. */
export const issueCertificateSchema = z.object({
  reservationId: z.uuid(),
  kind: z.enum(certificateKinds),
  addressee: optionalText(160),
});

/** Portal: the buyer's own statement of account. */
export const portalStatementSchema = z.object({ reservationId: z.uuid() });
