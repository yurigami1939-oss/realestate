CREATE TABLE "charge_reminder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"overdue" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"pay_by" date NOT NULL,
	"addressee_name" text,
	"addressee_name_ar" text,
	"addressee_address" text,
	"pdf_file_id" uuid,
	CONSTRAINT "charge_reminder_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_reminder_overdue" CHECK ("charge_reminder"."overdue" > 0)
);
--> statement-breakpoint
ALTER TABLE "charge_reminder" ADD CONSTRAINT "charge_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_reminder" ADD CONSTRAINT "charge_reminder_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_reminder" ADD CONSTRAINT "charge_reminder_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_reminder" ADD CONSTRAINT "charge_reminder_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_reminder" ADD CONSTRAINT "charge_reminder_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charge_reminder_organization_id_residence_id_unit_id_index" ON "charge_reminder" USING btree ("organization_id","residence_id","unit_id");