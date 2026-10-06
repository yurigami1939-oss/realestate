/** Isomorphic: the management reports' filters (URL search params). */
import { z } from "zod";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** A period (this year by default) and optionally one project. */
export const reportParams = z.object({
  from: day,
  to: day,
  project: z.uuid().optional().catch(undefined),
});
export type ReportParams = z.output<typeof reportParams>;
