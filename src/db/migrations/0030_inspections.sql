CREATE TYPE "public"."inspection_kind" AS ENUM('check_in', 'check_out');--> statement-breakpoint
CREATE TABLE "lease_inspection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" "inspection_kind" NOT NULL,
	"inspected_on" date NOT NULL,
	"items" jsonb NOT NULL,
	"electricity_meter" text,
	"gas_meter" text,
	"water_meter" text,
	"keys_count" integer,
	"observations" text,
	"pdf_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lease_inspection_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lease_inspection_kind_key" UNIQUE("organization_id","lease_id","kind"),
	CONSTRAINT "lease_inspection_keys" CHECK ("lease_inspection"."keys_count" is null or "lease_inspection"."keys_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lease_inspection" ADD CONSTRAINT "lease_inspection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_inspection" ADD CONSTRAINT "lease_inspection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_inspection" ADD CONSTRAINT "lease_inspection_lease_fk" FOREIGN KEY ("organization_id","lease_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_inspection" ADD CONSTRAINT "lease_inspection_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;