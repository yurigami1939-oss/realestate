CREATE TABLE "schedule_amendment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"signed_on" date NOT NULL,
	"reason" text NOT NULL,
	"paid" bigint NOT NULL,
	"replaced" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "schedule_amendment_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "schedule_amendment_sequence_key" UNIQUE("organization_id","reservation_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "schedule_amendment" ADD CONSTRAINT "schedule_amendment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_amendment" ADD CONSTRAINT "schedule_amendment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_amendment" ADD CONSTRAINT "schedule_amendment_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_amendment" ADD CONSTRAINT "schedule_amendment_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;