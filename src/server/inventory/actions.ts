"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import {
  applyPriceList,
  createPriceList,
  discardPriceList,
  setPriceListItems,
} from "./price-lists";
import {
  createBuildingSchema,
  createPriceListSchema,
  createProjectSchema,
  createUnitSchema,
  deleteBuildingSchema,
  deleteProjectSchema,
  deleteUnitSchema,
  generateUnitsSchema,
  priceListIdSchema,
  setPriceListItemsSchema,
  unitStatusReasonSchema,
  updateBuildingSchema,
  updateProjectSchema,
  updateUnitPriceSchema,
  updateUnitSchema,
} from "./schemas";
import {
  blockUnit,
  createBuilding,
  createProject,
  createUnit,
  deleteBuilding,
  deleteProject,
  deleteUnit,
  generateUnits,
  unblockUnit,
  updateBuilding,
  updateProject,
  updateUnit,
  updateUnitPrice,
} from "./service";

/** Every inventory page lives under /[locale]/projects. */
const revalidateInventory = () => revalidatePath("/[locale]/projects", "layout");

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    revalidateInventory();
    return result;
  });
}

export const createProjectAction = defineAction(
  { input: createProjectSchema, permission: "project:create" },
  (input, ctx) => mutation(() => createProject(ctx, input)),
);
export const updateProjectAction = defineAction(
  { input: updateProjectSchema, permission: "project:update" },
  (input, ctx) => mutation(() => updateProject(ctx, input)),
);
export const deleteProjectAction = defineAction(
  { input: deleteProjectSchema, permission: "project:delete" },
  (input, ctx) => mutation(() => deleteProject(ctx, input)),
);

export const createBuildingAction = defineAction(
  { input: createBuildingSchema, permission: "project:update" },
  (input, ctx) => mutation(() => createBuilding(ctx, input)),
);
export const updateBuildingAction = defineAction(
  { input: updateBuildingSchema, permission: "project:update" },
  (input, ctx) => mutation(() => updateBuilding(ctx, input)),
);
export const deleteBuildingAction = defineAction(
  { input: deleteBuildingSchema, permission: "project:update" },
  (input, ctx) => mutation(() => deleteBuilding(ctx, input)),
);

export const createUnitAction = defineAction(
  { input: createUnitSchema, permission: "unit:create" },
  (input, ctx) => mutation(() => createUnit(ctx, input)),
);
export const updateUnitAction = defineAction(
  { input: updateUnitSchema, permission: "unit:update" },
  (input, ctx) => mutation(() => updateUnit(ctx, input)),
);
export const deleteUnitAction = defineAction(
  { input: deleteUnitSchema, permission: "unit:delete" },
  (input, ctx) => mutation(() => deleteUnit(ctx, input)),
);
export const generateUnitsAction = defineAction(
  { input: generateUnitsSchema, permission: "unit:create" },
  (input, ctx) => mutation(() => generateUnits(ctx, input)),
);
export const blockUnitAction = defineAction(
  { input: unitStatusReasonSchema, permission: "unit:block" },
  (input, ctx) => mutation(() => blockUnit(ctx, input)),
);
export const unblockUnitAction = defineAction(
  { input: unitStatusReasonSchema, permission: "unit:block" },
  (input, ctx) => mutation(() => unblockUnit(ctx, input)),
);
export const updateUnitPriceAction = defineAction(
  { input: updateUnitPriceSchema, permission: "price:update" },
  (input, ctx) => mutation(() => updateUnitPrice(ctx, input)),
);

export const createPriceListAction = defineAction(
  { input: createPriceListSchema, permission: "price:update" },
  (input, ctx) => mutation(() => createPriceList(ctx, input)),
);
export const setPriceListItemsAction = defineAction(
  { input: setPriceListItemsSchema, permission: "price:update" },
  (input, ctx) => mutation(() => setPriceListItems(ctx, input)),
);
export const applyPriceListAction = defineAction(
  { input: priceListIdSchema, permission: "price:update" },
  (input, ctx) => mutation(() => applyPriceList(ctx, input)),
);
export const discardPriceListAction = defineAction(
  { input: priceListIdSchema, permission: "price:update" },
  (input, ctx) => mutation(() => discardPriceList(ctx, input)),
);
