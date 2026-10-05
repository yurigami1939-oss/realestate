CREATE TYPE "public"."certificate_kind" AS ENUM('reservation', 'payments', 'paid_in_full', 'progress', 'statement');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'certificate';--> statement-breakpoint
CREATE TABLE "certificate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "certificate_kind" NOT NULL,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"from_portal" boolean DEFAULT false NOT NULL,
	"addressee" text,
	"paid" bigint NOT NULL,
	"data" jsonb NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "certificate_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "certificate_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_organization_id_reservation_id_index" ON "certificate" USING btree ("organization_id","reservation_id");