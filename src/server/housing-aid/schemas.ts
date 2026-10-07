/** Isomorphic: the LPA settings form (CLAUDE.md §7 After the reservation). */
import { z } from "zod";

import { moneyText, optionalMoneyText, optionalPercentText, percentText } from "@/lib/zod";

/** Multiples of the SNMG are typed like percentages ("6", "1,5") and kept in hundredths. */
const multiple = () => percentText(0, 100);

/** SNMG, LPA income ceiling and the CNL aid and subsidised rate brackets, saved as a whole. */
export const housingAidSchema = z.object({
  snmg: optionalMoneyText(),
  lpaMaxMultiple: optionalPercentText(0, 100),
  cnlBrackets: z
    .array(
      z.object({
        maxMultiple: multiple(),
        amount: moneyText().refine((v) => v > 0n, "validation.amount"),
      }),
    )
    .max(10),
  rateBrackets: z.array(z.object({ maxMultiple: multiple(), rate: percentText(0, 20) })).max(10),
});
