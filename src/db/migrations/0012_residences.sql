CREATE TYPE "public"."charge_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."resident_kind" AS ENUM('co_owner', 'occupant');--> statement-breakpoint
CREATE TABLE "residence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"commune" text,
	"wilaya" text,
	"share_basis" integer DEFAULT 10000 NOT NULL,
	"charge_frequency" charge_frequency DEFAULT 'quarterly' NOT NULL,
	"reserve_fund_bp" integer DEFAULT 0 NOT NULL,
	"call_due_days" integer DEFAULT 30 NOT NULL,
	"manager_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "residence_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "residence_share_basis" CHECK ("residence"."share_basis" between 1 and 1000000),
	CONSTRAINT "residence_reserve_fund" CHECK ("residence"."reserve_fund_bp" between 0 and 10000),
	CONSTRAINT "residence_call_due_days" CHECK ("residence"."call_due_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "residence_unit" (
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"share" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "residence_unit_residence_id_unit_id_pk" PRIMARY KEY("residence_id","unit_id"),
	CONSTRAINT "residence_unit_unit_key" UNIQUE("organization_id","unit_id"),
	CONSTRAINT "residence_unit_share" CHECK ("residence_unit"."share" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resident" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" "resident_kind" NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name_ar" text,
	"first_name_ar" text,
	"phone" text,
	"email" text,
	"address" text,
	"buyer_id" uuid,
	"since_on" date,
	"until_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "resident_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "resident_period" CHECK ("resident"."until_on" is null or "resident"."since_on" is null or "resident"."until_on" >= "resident"."since_on")
);
--> statement-breakpoint
ALTER TABLE "residence" ADD CONSTRAINT "residence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence" ADD CONSTRAINT "residence_manager_user_id_user_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence" ADD CONSTRAINT "residence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence" ADD CONSTRAINT "residence_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence" ADD CONSTRAINT "residence_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_unit" ADD CONSTRAINT "residence_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_unit" ADD CONSTRAINT "residence_unit_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_unit" ADD CONSTRAINT "residence_unit_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_residence_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_buyer_fk" FOREIGN KEY ("organization_id","buyer_id") REFERENCES "public"."buyer"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "residence_organization_id_project_id_index" ON "residence" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "resident_organization_id_residence_id_unit_id_index" ON "resident" USING btree ("organization_id","residence_id","unit_id");