CREATE TYPE "public"."budget_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."distribution_key" AS ENUM('share', 'equal', 'per_building', 'custom');--> statement-breakpoint
CREATE TYPE "public"."distribution_weighting" AS ENUM('share', 'equal');--> statement-breakpoint
CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"frequency" charge_frequency,
	"reserve_fund_bp" integer,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "budget_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "budget_residence_key" UNIQUE("organization_id","residence_id","id"),
	CONSTRAINT "budget_year_key" UNIQUE("organization_id","residence_id","year"),
	CONSTRAINT "budget_year" CHECK ("budget"."year" between 2000 and 2100),
	CONSTRAINT "budget_approval" CHECK (("budget"."status" = 'approved') = ("budget"."approved_at" is not null and "budget"."frequency" is not null and "budget"."reserve_fund_bp" is not null))
);
--> statement-breakpoint
CREATE TABLE "budget_line" (
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "budget_line_budget_id_category_id_pk" PRIMARY KEY("budget_id","category_id"),
	CONSTRAINT "budget_line_amount" CHECK ("budget_line"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "charge_category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"key" "distribution_key" DEFAULT 'share' NOT NULL,
	"weighting" "distribution_weighting" DEFAULT 'share' NOT NULL,
	"building_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "charge_category_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_category_residence_key" UNIQUE("organization_id","residence_id","id"),
	CONSTRAINT "charge_category_building" CHECK (("charge_category"."key" = 'per_building') = ("charge_category"."building_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "charge_category_unit" (
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "charge_category_unit_category_id_unit_id_pk" PRIMARY KEY("category_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_budget_fk" FOREIGN KEY ("organization_id","residence_id","budget_id") REFERENCES "public"."budget"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line" ADD CONSTRAINT "budget_line_category_fk" FOREIGN KEY ("organization_id","residence_id","category_id") REFERENCES "public"."charge_category"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category" ADD CONSTRAINT "charge_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category" ADD CONSTRAINT "charge_category_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category" ADD CONSTRAINT "charge_category_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category" ADD CONSTRAINT "charge_category_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category" ADD CONSTRAINT "charge_category_building_fk" FOREIGN KEY ("organization_id","building_id") REFERENCES "public"."building"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category_unit" ADD CONSTRAINT "charge_category_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category_unit" ADD CONSTRAINT "charge_category_unit_category_fk" FOREIGN KEY ("organization_id","residence_id","category_id") REFERENCES "public"."charge_category"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_category_unit" ADD CONSTRAINT "charge_category_unit_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;