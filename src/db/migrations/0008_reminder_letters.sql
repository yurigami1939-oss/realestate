CREATE TABLE "reminder_letter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"overdue" bigint NOT NULL,
	"penalties" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"pay_by" date NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "reminder_letter_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reminder_letter_amounts" CHECK ("reminder_letter"."overdue" > 0 and "reminder_letter"."penalties" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reminder_letter" ADD CONSTRAINT "reminder_letter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_letter" ADD CONSTRAINT "reminder_letter_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_letter" ADD CONSTRAINT "reminder_letter_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_letter" ADD CONSTRAINT "reminder_letter_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_letter_organization_id_reservation_id_index" ON "reminder_letter" USING btree ("organization_id","reservation_id");