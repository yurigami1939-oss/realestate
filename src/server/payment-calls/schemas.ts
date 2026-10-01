/** Isomorphic: shared by the milestone validation dialog and its action. */
import { z } from "zod";

import { dateText } from "@/lib/zod";

/** A construction milestone reached on a date (not in the future). */
export const validateMilestoneSchema = z.object({
  milestoneId: z.uuid(),
  validatedOn: dateText(),
});
