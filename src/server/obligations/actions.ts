"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  createProjectDocumentSchema,
  projectDocumentIdSchema,
  updateProjectDocumentSchema,
} from "./schemas";
import { createProjectDocument, deleteProjectDocument, updateProjectDocument } from "./service";

const refresh = () => revalidatePath("/[locale]/projects", "layout");

export const createProjectDocumentAction = defineAction(
  { input: createProjectDocumentSchema, permission: "project:update" },
  async (input, ctx) => {
    const created = await createProjectDocument(ctx, input);
    refresh();
    return created;
  },
);

export const updateProjectDocumentAction = defineAction(
  { input: updateProjectDocumentSchema, permission: "project:update" },
  async (input, ctx) => {
    await updateProjectDocument(ctx, input);
    refresh();
  },
);

export const deleteProjectDocumentAction = defineAction(
  { input: projectDocumentIdSchema, permission: "project:update" },
  async (input, ctx) => {
    await deleteProjectDocument(ctx, input);
    refresh();
  },
);
