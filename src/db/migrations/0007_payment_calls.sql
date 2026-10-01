CREATE TABLE "payment_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"installment_position" integer NOT NULL,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"settled" bigint NOT NULL,
	"called" bigint NOT NULL,
	"due_on" date NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "payment_call_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_call_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "payment_call_installment_key" UNIQUE("organization_id","reservation_id","installment_position"),
	CONSTRAINT "payment_call_amounts" CHECK ("payment_call"."settled" >= 0 and "payment_call"."called" > 0 and "payment_call"."settled" + "payment_call"."called" = "payment_call"."amount")
);
--> statement-breakpoint
ALTER TABLE "payment_call" ADD CONSTRAINT "payment_call_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_call" ADD CONSTRAINT "payment_call_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_call" ADD CONSTRAINT "payment_call_milestone_fk" FOREIGN KEY ("organization_id","milestone_id") REFERENCES "public"."construction_milestone"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_call" ADD CONSTRAINT "payment_call_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_call_organization_id_milestone_id_index" ON "payment_call" USING btree ("organization_id","milestone_id");