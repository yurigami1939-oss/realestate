CREATE TYPE "public"."project_document_kind" AS ENUM('land_title', 'building_permit', 'subdivision_permit', 'technical_control', 'insurance', 'fgcmpi', 'conformity_certificate', 'other');--> statement-breakpoint
CREATE TABLE "project_document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "project_document_kind" NOT NULL,
	"title" text,
	"reference" text,
	"issued_on" date,
	"expires_on" date,
	"issuer" text,
	"notes" text,
	"scan_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "project_document_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "delivery_penalty_monthly_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "delivery_penalty_cap_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "fgcmpi_number" text;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "delivery_due_on" date;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "guarantee_number" text;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "guarantee_issued_on" date;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "guarantee_scan_file_id" uuid;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_scan_fk" FOREIGN KEY ("organization_id","scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_document_organization_id_project_id_index" ON "project_document" USING btree ("organization_id","project_id");--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_guarantee_fk" FOREIGN KEY ("organization_id","guarantee_scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_delivery_penalty" CHECK ("organization_setting"."delivery_penalty_monthly_rate_bp" between 0 and 1000
        and "organization_setting"."delivery_penalty_cap_bp" between 0 and 10000);