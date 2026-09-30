"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { completeFollowUp, createFollowUp } from "./follow-ups";
import {
  addLeadNote,
  assignLead,
  changeLeadStage,
  createLead,
  deleteLead,
  mergeLeads,
  updateLead,
} from "./leads";
import {
  addLeadNoteSchema,
  assignLeadSchema,
  changeLeadStageSchema,
  completeFollowUpSchema,
  createFollowUpSchema,
  createLeadSchema,
  leadIdSchema,
  mergeLeadsSchema,
  scheduleVisitSchema,
  updateLeadSchema,
  updateVisitSchema,
} from "./schemas";
import { scheduleVisit, updateVisit } from "./visits";

/** CRM pages: /leads (list, pipeline, duplicates, sheets), /follow-ups, /visits, dashboard. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of ["/[locale]/leads", "/[locale]/follow-ups", "/[locale]/visits"]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const createLeadAction = defineAction(
  { input: createLeadSchema, permission: "lead:create" },
  (input, ctx) => mutation(() => createLead(ctx, input)),
);
export const updateLeadAction = defineAction(
  { input: updateLeadSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => updateLead(ctx, input)),
);
export const changeLeadStageAction = defineAction(
  { input: changeLeadStageSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => changeLeadStage(ctx, input)),
);
export const assignLeadAction = defineAction(
  { input: assignLeadSchema, permission: "lead:assign" },
  (input, ctx) => mutation(() => assignLead(ctx, input)),
);
export const addLeadNoteAction = defineAction(
  { input: addLeadNoteSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => addLeadNote(ctx, input)),
);
export const mergeLeadsAction = defineAction(
  { input: mergeLeadsSchema, permission: "lead:merge" },
  (input, ctx) => mutation(() => mergeLeads(ctx, input)),
);
export const deleteLeadAction = defineAction(
  { input: leadIdSchema, permission: "lead:delete" },
  (input, ctx) => mutation(() => deleteLead(ctx, input)),
);
export const scheduleVisitAction = defineAction(
  { input: scheduleVisitSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => scheduleVisit(ctx, input)),
);
export const updateVisitAction = defineAction(
  { input: updateVisitSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => updateVisit(ctx, input)),
);
export const createFollowUpAction = defineAction(
  { input: createFollowUpSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => createFollowUp(ctx, input)),
);
export const completeFollowUpAction = defineAction(
  { input: completeFollowUpSchema, permission: "lead:update" },
  (input, ctx) => mutation(() => completeFollowUp(ctx, input)),
);
