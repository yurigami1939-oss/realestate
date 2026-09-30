CREATE TYPE "public"."plan_step_trigger" AS ENUM('signing', 'months_after_signing', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TABLE "construction_milestone" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"planned_on" date,
	"validated_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "construction_milestone_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "construction_milestone_organizationId_projectId_id_unique" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "organization_setting" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"quotation_validity_days" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "organization_setting_validity_range" CHECK ("organization_setting"."quotation_validity_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "payment_plan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "payment_plan_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_plan_organizationId_projectId_id_unique" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_plan_step" (
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"share_bp" integer NOT NULL,
	"trigger" "plan_step_trigger" NOT NULL,
	"months" integer,
	"milestone_id" uuid,
	CONSTRAINT "payment_plan_step_plan_id_position_pk" PRIMARY KEY("plan_id","position"),
	CONSTRAINT "payment_plan_step_share" CHECK ("payment_plan_step"."share_bp" between 1 and 10000),
	CONSTRAINT "payment_plan_step_trigger" CHECK (("payment_plan_step"."trigger" = 'months_after_signing') = ("payment_plan_step"."months" is not null)
        and ("payment_plan_step"."trigger" = 'milestone') = ("payment_plan_step"."milestone_id" is not null)),
	CONSTRAINT "payment_plan_step_months" CHECK ("payment_plan_step"."months" is null or "payment_plan_step"."months" between 0 and 240)
);
--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payment_plan_id" uuid NOT NULL,
	"list_price" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"price" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signing_on" date NOT NULL,
	"valid_until" date NOT NULL,
	"issued_by" uuid NOT NULL,
	"notes" text,
	"status" "quotation_status" DEFAULT 'issued' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"pdf_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quotation_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "quotation_amounts" CHECK ("quotation"."discount" >= 0 and "quotation"."price" = "quotation"."list_price" - "quotation"."discount"),
	CONSTRAINT "quotation_cancellation" CHECK (("quotation"."status" = 'cancelled') = ("quotation"."cancelled_at" is not null and "quotation"."cancellation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "quotation_line" (
	"organization_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"share_bp" integer NOT NULL,
	"amount" bigint NOT NULL,
	"trigger" "plan_step_trigger" NOT NULL,
	"due_on" date,
	"milestone_name" text,
	CONSTRAINT "quotation_line_quotation_id_position_pk" PRIMARY KEY("quotation_id","position")
);
--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD CONSTRAINT "construction_milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD CONSTRAINT "construction_milestone_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD CONSTRAINT "construction_milestone_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD CONSTRAINT "construction_milestone_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_step" ADD CONSTRAINT "payment_plan_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_step" ADD CONSTRAINT "payment_plan_step_plan_fk" FOREIGN KEY ("organization_id","project_id","plan_id") REFERENCES "public"."payment_plan"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_step" ADD CONSTRAINT "payment_plan_step_milestone_fk" FOREIGN KEY ("organization_id","project_id","milestone_id") REFERENCES "public"."construction_milestone"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_payment_plan_fk" FOREIGN KEY ("organization_id","project_id","payment_plan_id") REFERENCES "public"."payment_plan"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_quotation_fk" FOREIGN KEY ("organization_id","quotation_id") REFERENCES "public"."quotation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "construction_milestone_organization_id_project_id_position_index" ON "construction_milestone" USING btree ("organization_id","project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_plan_one_default" ON "payment_plan" USING btree ("organization_id","project_id") WHERE "payment_plan"."is_default" and "payment_plan"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "quotation_organization_id_lead_id_index" ON "quotation" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "quotation_organization_id_issued_at_index" ON "quotation" USING btree ("organization_id","issued_at");