import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  orientations,
  projectStatuses,
  typologies,
  unitStatuses,
  unitTypes,
} from "../../lib/inventory";

import {
  createdAt,
  id,
  instant,
  money,
  organizationId,
  softDelete,
  timestamps,
  userRef,
} from "./_columns";
import { file } from "./files";

/*
 * Tenant references are composite — (organization_id, parent_id) → parent(organization_id, id) —
 * because foreign-key checks bypass RLS: a row can never point at another tenant's row.
 */

export const projectStatus = pgEnum("project_status", projectStatuses);
export const unitType = pgEnum("unit_type", unitTypes);
export const typology = pgEnum("typology", typologies);
export const orientation = pgEnum("orientation", orientations);
export const unitStatus = pgEnum("unit_status", unitStatuses);
export const priceListStatus = pgEnum("price_list_status", ["draft", "applied", "discarded"]);

const area = () => numeric({ precision: 10, scale: 2 });
const notDeleted = (t: { deletedAt: unknown }) => sql`${t.deletedAt} is null`;

/** Promotion immobilière. */
export const project = pgTable(
  "project",
  {
    id: id(),
    organizationId: organizationId(),
    code: text().notNull(),
    name: text().notNull(),
    status: projectStatus().notNull().default("planning"),
    address: text(),
    wilaya: text(),
    commune: text(),
    buildingPermitNumber: text(),
    buildingPermitDate: date({ mode: "string" }),
    launchedOn: date({ mode: "string" }),
    plannedDeliveryOn: date({ mode: "string" }),
    description: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    uniqueIndex().on(t.organizationId, t.code).where(notDeleted(t)),
  ],
);

/** Bloc / bâtiment. Floors run from `lowestFloor` (≤ 0, basements negative) to `topFloor`; 0 = RDC. */
export const building = pgTable(
  "building",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    lowestFloor: integer().notNull().default(0),
    topFloor: integer().notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      name: "building_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    uniqueIndex().on(t.organizationId, t.projectId, t.code).where(notDeleted(t)),
    check("building_floor_range", sql`${t.lowestFloor} <= 0 and ${t.topFloor} >= ${t.lowestFloor}`),
  ],
);

/** Lot. `status` is written only by `transitionUnit` (src/server/inventory). */
export const unit = pgTable(
  "unit",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    buildingId: uuid().notNull(),
    code: text().notNull(),
    floor: integer().notNull(),
    type: unitType().notNull().default("apartment"),
    typology: typology(),
    isDuplex: boolean().notNull().default(false),
    livingArea: area(),
    usableArea: area(),
    outdoorArea: area(),
    orientations: orientation()
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Quote-part / tantièmes (integer weight). */
    share: integer(),
    /** Current list price (centimes). Reservations snapshot it; history in unit_price_history. */
    listPrice: money(),
    status: unitStatus().notNull().default("available"),
    floorPlanFileId: uuid(),
    notes: text(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "unit_building_fk",
      columns: [t.organizationId, t.projectId, t.buildingId],
      foreignColumns: [building.organizationId, building.projectId, building.id],
    }),
    foreignKey({
      name: "unit_floor_plan_fk",
      columns: [t.organizationId, t.floorPlanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    uniqueIndex().on(t.organizationId, t.projectId, t.code).where(notDeleted(t)),
    index().on(t.organizationId, t.buildingId, t.floor),
    index().on(t.organizationId, t.projectId, t.status),
    check("unit_share_positive", sql`${t.share} is null or ${t.share} > 0`),
    check("unit_list_price_non_negative", sql`${t.listPrice} is null or ${t.listPrice} >= 0`),
  ],
);

/** Every status change of a unit (append-only). */
export const unitStatusHistory = pgTable(
  "unit_status_history",
  {
    id: id(),
    organizationId: organizationId(),
    unitId: uuid().notNull(),
    fromStatus: unitStatus(),
    toStatus: unitStatus().notNull(),
    reason: text(),
    /** What caused it, e.g. `reservation` + id. */
    refType: text(),
    refId: uuid(),
    actorUserId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "unit_status_history_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    index().on(t.organizationId, t.unitId, t.createdAt),
  ],
);

/** Grille de prix: a versioned set of unit prices, applied in one go. */
export const priceList = pgTable(
  "price_list",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    version: integer().notNull(),
    name: text().notNull(),
    status: priceListStatus().notNull().default("draft"),
    notes: text(),
    appliedAt: instant(),
    appliedBy: userRef(),
    ...timestamps(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.version),
    foreignKey({
      name: "price_list_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
  ],
);

export const priceListItem = pgTable(
  "price_list_item",
  {
    organizationId: organizationId(),
    priceListId: uuid().notNull(),
    unitId: uuid().notNull(),
    price: money().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.priceListId, t.unitId] }),
    foreignKey({
      name: "price_list_item_price_list_fk",
      columns: [t.organizationId, t.priceListId],
      foreignColumns: [priceList.organizationId, priceList.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "price_list_item_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    check("price_list_item_price_non_negative", sql`${t.price} >= 0`),
  ],
);

/** Every list-price change of a unit (append-only). */
export const unitPriceHistory = pgTable(
  "unit_price_history",
  {
    id: id(),
    organizationId: organizationId(),
    unitId: uuid().notNull(),
    oldPrice: money(),
    newPrice: money(),
    /** Set when the change comes from applying a price list. */
    priceListId: uuid(),
    reason: text(),
    actorUserId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "unit_price_history_unit_fk",
      columns: [t.organizationId, t.unitId],
      foreignColumns: [unit.organizationId, unit.id],
    }),
    foreignKey({
      name: "unit_price_history_price_list_fk",
      columns: [t.organizationId, t.priceListId],
      foreignColumns: [priceList.organizationId, priceList.id],
    }),
    index().on(t.organizationId, t.unitId, t.createdAt),
  ],
);
