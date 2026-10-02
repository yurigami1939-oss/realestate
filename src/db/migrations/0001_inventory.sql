CREATE TYPE "public"."orientation" AS ENUM('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW');--> statement-breakpoint
CREATE TYPE "public"."price_list_status" AS ENUM('draft', 'applied', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'under_construction', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."typology" AS ENUM('F1', 'F2', 'F3', 'F4', 'F5', 'F6');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('available', 'optioned', 'reserved', 'sold', 'delivered', 'rented', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('apartment', 'commercial', 'office', 'parking', 'storage', 'villa');--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "file_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "building" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"lowest_floor" integer DEFAULT 0 NOT NULL,
	"top_floor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "building_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "building_organizationId_projectId_id_unique" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "building_floor_range" CHECK ("building"."lowest_floor" <= 0 and "building"."top_floor" >= "building"."lowest_floor")
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"status" "price_list_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "price_list_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "price_list_organizationId_projectId_version_unique" UNIQUE("organization_id","project_id","version")
);
--> statement-breakpoint
CREATE TABLE "price_list_item" (
	"organization_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	CONSTRAINT "price_list_item_price_list_id_unit_id_pk" PRIMARY KEY("price_list_id","unit_id"),
	CONSTRAINT "price_list_item_price_non_negative" CHECK ("price_list_item"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"address" text,
	"wilaya" text,
	"commune" text,
	"building_permit_number" text,
	"building_permit_date" date,
	"launched_on" date,
	"planned_delivery_on" date,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "project_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"code" text NOT NULL,
	"floor" integer NOT NULL,
	"type" "unit_type" DEFAULT 'apartment' NOT NULL,
	"typology" "typology",
	"is_duplex" boolean DEFAULT false NOT NULL,
	"living_area" numeric(10, 2),
	"usable_area" numeric(10, 2),
	"outdoor_area" numeric(10, 2),
	"orientations" "orientation"[] DEFAULT '{}' NOT NULL,
	"share" integer,
	"list_price" bigint,
	"status" "unit_status" DEFAULT 'available' NOT NULL,
	"floor_plan_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "unit_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "unit_share_positive" CHECK ("unit"."share" is null or "unit"."share" > 0),
	CONSTRAINT "unit_list_price_non_negative" CHECK ("unit"."list_price" is null or "unit"."list_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "unit_price_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"old_price" bigint,
	"new_price" bigint,
	"price_list_id" uuid,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"from_status" "unit_status",
	"to_status" "unit_status" NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" uuid,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_applied_by_user_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_price_list_fk" FOREIGN KEY ("organization_id","price_list_id") REFERENCES "public"."price_list"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_building_fk" FOREIGN KEY ("organization_id","project_id","building_id") REFERENCES "public"."building"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_floor_plan_fk" FOREIGN KEY ("organization_id","floor_plan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_price_history" ADD CONSTRAINT "unit_price_history_price_list_fk" FOREIGN KEY ("organization_id","price_list_id") REFERENCES "public"."price_list"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_organization_id_entity_type_entity_id_index" ON "file" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "building_organization_id_project_id_code_index" ON "building" USING btree ("organization_id","project_id","code") WHERE "building"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_organization_id_code_index" ON "project" USING btree ("organization_id","code") WHERE "project"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_organization_id_project_id_code_index" ON "unit" USING btree ("organization_id","project_id","code") WHERE "unit"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "unit_organization_id_building_id_floor_index" ON "unit" USING btree ("organization_id","building_id","floor");--> statement-breakpoint
CREATE INDEX "unit_organization_id_project_id_status_index" ON "unit" USING btree ("organization_id","project_id","status");--> statement-breakpoint
CREATE INDEX "unit_price_history_organization_id_unit_id_created_at_index" ON "unit_price_history" USING btree ("organization_id","unit_id","created_at");--> statement-breakpoint
CREATE INDEX "unit_status_history_organization_id_unit_id_created_at_index" ON "unit_status_history" USING btree ("organization_id","unit_id","created_at");