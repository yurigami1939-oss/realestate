"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { AppError, err, ok, type Result } from "@/lib/result";

import { moneyText } from "@/lib/zod";
import { addonCodes } from "@/lib/subscriptions";

import { defineConsoleAction } from "./action";
import {
  cancelConsolePayment,
  issueCreditNote,
  issueInvoice,
  recordConsolePayment,
  saveOperatorProfile,
} from "./billing";
import { changeSubscriptionStatus } from "./lifecycle";
import { createPlan } from "./plans";
import { createProvision, resendProvision, revokeProvision } from "./provisions";
import {
  accountIdentitySchema,
  activateSchema,
  pilotGoalIdSchema,
  pilotGoalSchema,
  planIdSchema,
  planSchema,
  provisionIdSchema,
  provisionSchema,
  statusChangeSchema,
  subscriptionAddonSchema,
  subscriptionTermsSchema,
  supportStartSchema,
  cancelConsolePaymentSchema,
  consolePaymentSchema,
  creditNoteSchema,
  issueInvoiceSchema,
  operatorProfileSchema,
} from "./schemas";
import {
  activateSubscription,
  addPilotGoal,
  archivePlan,
  repriceAddon,
  setSubscriptionAddon,
  updateAccountIdentity,
  updatePilotGoal,
  updateSubscriptionTerms,
} from "./service";
import { startSupportSession, stopSupportSession } from "./support";

const refresh = () => revalidatePath("/[locale]/console", "layout");

export const updateAccountIdentityAction = defineConsoleAction(
  { input: accountIdentitySchema },
  async (input, ctx) => {
    await updateAccountIdentity(ctx, input);
    refresh();
  },
);

export const updateSubscriptionTermsAction = defineConsoleAction(
  { input: subscriptionTermsSchema },
  async (input, ctx) => {
    await updateSubscriptionTerms(ctx, input);
    refresh();
  },
);

export const setSubscriptionAddonAction = defineConsoleAction(
  { input: subscriptionAddonSchema },
  async (input, ctx) => {
    await setSubscriptionAddon(ctx, input);
    refresh();
  },
);

export const activateSubscriptionAction = defineConsoleAction(
  { input: activateSchema },
  async (input, ctx) => {
    await activateSubscription(ctx, {
      billingAccountId: input.billingAccountId,
      startsOn: input.startsOn,
    });
    refresh();
  },
);

/** Suspend, reactivate, terminate (and back to suspended before the purge). */
export const changeSubscriptionStatusAction = defineConsoleAction(
  { input: statusChangeSchema },
  async (input, ctx) => {
    await changeSubscriptionStatus(ctx, input);
    refresh();
  },
);

export const addPilotGoalAction = defineConsoleAction(
  { input: pilotGoalSchema },
  async (input, ctx) => {
    await addPilotGoal(ctx, input);
    refresh();
  },
);

export const togglePilotGoalAction = defineConsoleAction(
  { input: pilotGoalIdSchema },
  async (input, ctx) => {
    await updatePilotGoal(ctx, { goalId: input.goalId, done: input.done === true });
    refresh();
  },
);

export const deletePilotGoalAction = defineConsoleAction(
  { input: pilotGoalIdSchema },
  async (input, ctx) => {
    await updatePilotGoal(ctx, { goalId: input.goalId, remove: true });
    refresh();
  },
);

export const createPlanAction = defineConsoleAction({ input: planSchema }, async (input, ctx) => {
  await createPlan(ctx, input);
  refresh();
});

export const archivePlanAction = defineConsoleAction(
  { input: planIdSchema },
  async (input, ctx) => {
    await archivePlan(ctx, input.planId);
    refresh();
  },
);

export const repriceAddonAction = defineConsoleAction(
  {
    input: z.object({
      code: z.enum(addonCodes),
      yearlyPrice: moneyText(),
      quarterlyPrice: moneyText(),
    }),
  },
  async (input, ctx) => {
    await repriceAddon(ctx, input);
    refresh();
  },
);

/** Prepares a promoter's access; returns the link once (to pass on by message too). */
export const createProvisionAction = defineConsoleAction(
  { input: provisionSchema },
  async (input, ctx) => {
    const { url } = await createProvision(ctx, input);
    refresh();
    return { url };
  },
);

export const resendProvisionAction = defineConsoleAction(
  { input: provisionIdSchema },
  async (input, ctx) => {
    const { url } = await resendProvision(ctx, input.provisionId);
    refresh();
    return { url };
  },
);

export const revokeProvisionAction = defineConsoleAction(
  { input: provisionIdSchema },
  async (input, ctx) => {
    await revokeProvision(ctx, input.provisionId);
    refresh();
  },
);

/**
 * Opens a support session (CLAUDE.console.md §12): the operator's session is set aside and the
 * member's opens on the organization; the browser then goes to its dashboard.
 */
export const startSupportSessionAction = defineConsoleAction(
  { input: supportStartSchema },
  async (input, ctx) => {
    await startSupportSession(ctx, input, await headers());
  },
);

/**
 * Ends the support session the request runs in (the member's session, read-only: not a console
 * action nor a tenant one) and gives the operator their session back.
 */
export async function stopSupportSessionAction(): Promise<Result<{ restored: boolean }>> {
  try {
    return ok(await stopSupportSession(await headers()));
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) return err(error);
    console.error("[support] unexpected error", error);
    return err(new AppError("UNEXPECTED"));
  }
}

// ── Billing (CLAUDE.console.md §11) ─────────────────────────────────────────────────────────

export const saveOperatorProfileAction = defineConsoleAction(
  { input: operatorProfileSchema },
  async ({ vatRate, ...input }, ctx) => {
    await saveOperatorProfile(ctx, { ...input, vatRateBp: vatRate });
    refresh();
  },
);

export const issueInvoiceAction = defineConsoleAction(
  { input: issueInvoiceSchema },
  async (input, ctx) => {
    const issued = await issueInvoice(ctx, input);
    refresh();
    return { number: issued.number };
  },
);

export const issueCreditNoteAction = defineConsoleAction(
  { input: creditNoteSchema },
  async (input, ctx) => {
    const issued = await issueCreditNote(ctx, input);
    refresh();
    return { number: issued.number };
  },
);

export const recordConsolePaymentAction = defineConsoleAction(
  { input: consolePaymentSchema },
  async (input, ctx) => {
    await recordConsolePayment(ctx, input);
    refresh();
  },
);

export const cancelConsolePaymentAction = defineConsoleAction(
  { input: cancelConsolePaymentSchema },
  async (input, ctx) => {
    await cancelConsolePayment(ctx, input);
    refresh();
  },
);
