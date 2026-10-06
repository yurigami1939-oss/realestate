CREATE TYPE "public"."portal_request_kind" AS ENUM('certificate', 'appointment', 'other');--> statement-breakpoint
CREATE TYPE "public"."portal_request_status" AS ENUM('open', 'done', 'declined');--> statement-breakpoint
CREATE TYPE "public"."requestable_certificate" AS ENUM('reservation', 'payments', 'paid_in_full', 'progress');--> statement-breakpoint
CREATE TABLE "portal_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "portal_request_kind" NOT NULL,
	"certificate_kind" "requestable_certificate",
	"preferred_on" date,
	"message" text,
	"status" "portal_request_status" DEFAULT 'open' NOT NULL,
	"answer" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_request_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "portal_request_certificate" CHECK (("portal_request"."kind" = 'certificate') = ("portal_request"."certificate_kind" is not null))
);
--> statement-breakpoint
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_request" ADD CONSTRAINT "portal_request_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_request_organization_id_status_index" ON "portal_request" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "portal_request_organization_id_reservation_id_index" ON "portal_request" USING btree ("organization_id","reservation_id");