"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { moneyText } from "@/lib/zod";
import { addonCodes } from "@/lib/subscriptions";

import { defineConsoleAction } from "./action";
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
