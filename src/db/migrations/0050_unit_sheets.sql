CREATE TABLE "unit_sheet" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"status" "unit_status" NOT NULL,
	"list_price" bigint,
	"plan_name" text,
	"lines" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "unit_sheet_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "unit_sheet" ADD CONSTRAINT "unit_sheet_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sheet" ADD CONSTRAINT "unit_sheet_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sheet" ADD CONSTRAINT "unit_sheet_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sheet" ADD CONSTRAINT "unit_sheet_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_sheet_organization_id_unit_id_index" ON "unit_sheet" USING btree ("organization_id","unit_id");