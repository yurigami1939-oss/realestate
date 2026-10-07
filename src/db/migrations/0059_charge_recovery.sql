CREATE TYPE "public"."recovery_step_kind" AS ENUM('reminder', 'formal_notice', 'bailiff', 'court', 'judgment', 'agreement', 'note');--> statement-breakpoint
CREATE TABLE "charge_recovery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"opened_on" date NOT NULL,
	"closed_on" date,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "charge_recovery_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_recovery_closed" CHECK (("charge_recovery"."closed_on" is null) = ("charge_recovery"."close_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "charge_recovery_step" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recovery_id" uuid NOT NULL,
	"kind" "recovery_step_kind" NOT NULL,
	"done_on" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_recovery_step_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "charge_repayment_plan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recovery_id" uuid NOT NULL,
	"total" bigint NOT NULL,
	"months" integer NOT NULL,
	"first_due_on" date NOT NULL,
	"lines" jsonb NOT NULL,
	"paid_before" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "charge_repayment_plan_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_repayment_plan_amounts" CHECK ("charge_repayment_plan"."total" > 0 and "charge_repayment_plan"."months" between 1 and 24)
);
--> statement-breakpoint
ALTER TABLE "charge_recovery" ADD CONSTRAINT "charge_recovery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery" ADD CONSTRAINT "charge_recovery_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery" ADD CONSTRAINT "charge_recovery_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery" ADD CONSTRAINT "charge_recovery_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery_step" ADD CONSTRAINT "charge_recovery_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery_step" ADD CONSTRAINT "charge_recovery_step_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_recovery_step" ADD CONSTRAINT "charge_recovery_step_recovery_fk" FOREIGN KEY ("organization_id","recovery_id") REFERENCES "public"."charge_recovery"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_repayment_plan" ADD CONSTRAINT "charge_repayment_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_repayment_plan" ADD CONSTRAINT "charge_repayment_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_repayment_plan" ADD CONSTRAINT "charge_repayment_plan_recovery_fk" FOREIGN KEY ("organization_id","recovery_id") REFERENCES "public"."charge_recovery"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charge_recovery_open_key" ON "charge_recovery" USING btree ("organization_id","residence_id","unit_id") WHERE "charge_recovery"."closed_on" is null;--> statement-breakpoint
CREATE INDEX "charge_recovery_step_organization_id_recovery_id_done_on_index" ON "charge_recovery_step" USING btree ("organization_id","recovery_id","done_on");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_repayment_plan_live_key" ON "charge_repayment_plan" USING btree ("organization_id","recovery_id") WHERE "charge_repayment_plan"."cancelled_at" is null;