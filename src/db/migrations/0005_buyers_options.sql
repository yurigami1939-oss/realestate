CREATE TYPE "public"."buyer_document_kind" AS ENUM('id_card', 'birth_certificate', 'family_record', 'residence_certificate', 'employment_certificate', 'payslips', 'bank_statement', 'other');--> statement-breakpoint
CREATE TYPE "public"."civility" AS ENUM('mr', 'mrs');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('missing', 'received', 'verified');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('single', 'married', 'divorced', 'widowed');--> statement-breakpoint
CREATE TYPE "public"."construction_stage" AS ENUM('foundations', 'structure', 'completion', 'handover');--> statement-breakpoint
CREATE TYPE "public"."option_status" AS ENUM('active', 'expired', 'cancelled', 'converted');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'option_placed';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'option_ended';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'reserved';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'sale_signed';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'withdrawn';--> statement-breakpoint
CREATE TABLE "buyer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"owner_user_id" uuid,
	"civility" "civility",
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name_ar" text,
	"first_name_ar" text,
	"birth_date" date,
	"birth_place" text,
	"father_first_name" text,
	"mother_full_name" text,
	"nin" text,
	"id_card_number" text,
	"id_card_issued_on" date,
	"id_card_issued_by" text,
	"phone" text NOT NULL,
	"phone2" text,
	"email" text,
	"address" text,
	"commune" text,
	"wilaya" text,
	"profession" text,
	"employer" text,
	"marital_status" "marital_status",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "buyer_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "buyer_document" (
	"organization_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"kind" "buyer_document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'missing' NOT NULL,
	"file_id" uuid,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "buyer_document_buyer_id_kind_pk" PRIMARY KEY("buyer_id","kind")
);
--> statement-breakpoint
CREATE TABLE "unit_option" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "option_status" DEFAULT 'active' NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	CONSTRAINT "unit_option_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "unit_option_expiry" CHECK ("unit_option"."expires_at" > "unit_option"."placed_at")
);
--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD COLUMN "stage" "construction_stage";--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD COLUMN "validated_by" uuid;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "option_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "payment_call_delay_days" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "withdrawal_retention_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "penalty_monthly_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "penalty_grace_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "penalty_cap_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "default_commission_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "vsp_limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer" ADD CONSTRAINT "buyer_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_document" ADD CONSTRAINT "buyer_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_document" ADD CONSTRAINT "buyer_document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_document" ADD CONSTRAINT "buyer_document_buyer_fk" FOREIGN KEY ("organization_id","buyer_id") REFERENCES "public"."buyer"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_document" ADD CONSTRAINT "buyer_document_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_option" ADD CONSTRAINT "unit_option_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_option" ADD CONSTRAINT "unit_option_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_option" ADD CONSTRAINT "unit_option_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_option" ADD CONSTRAINT "unit_option_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_option" ADD CONSTRAINT "unit_option_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_nin_unique" ON "buyer" USING btree ("organization_id","nin") WHERE "buyer"."nin" is not null and "buyer"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "buyer_organization_id_lead_id_index" ON "buyer" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "buyer_organization_id_last_name_index" ON "buyer" USING btree ("organization_id","last_name");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_option_one_active" ON "unit_option" USING btree ("organization_id","unit_id") WHERE "unit_option"."status" = 'active';--> statement-breakpoint
CREATE INDEX "unit_option_organization_id_lead_id_index" ON "unit_option" USING btree ("organization_id","lead_id");--> statement-breakpoint
ALTER TABLE "construction_milestone" ADD CONSTRAINT "construction_milestone_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_option_hours" CHECK ("organization_setting"."option_hours" between 1 and 720);--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_call_delay" CHECK ("organization_setting"."payment_call_delay_days" between 0 and 180);--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_rates" CHECK ("organization_setting"."withdrawal_retention_bp" between 0 and 10000
        and "organization_setting"."penalty_monthly_rate_bp" between 0 and 1000
        and "organization_setting"."penalty_grace_days" between 0 and 365
        and "organization_setting"."penalty_cap_bp" between 0 and 10000
        and "organization_setting"."default_commission_rate_bp" between 0 and 2000);