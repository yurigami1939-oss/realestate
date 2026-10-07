CREATE TABLE "lease_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"monthly_rent" bigint NOT NULL,
	"monthly_charges" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lease_revision_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lease_revision_day_key" UNIQUE("organization_id","lease_id","effective_on"),
	CONSTRAINT "lease_revision_amounts" CHECK ("lease_revision"."monthly_rent" > 0 and "lease_revision"."monthly_charges" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "guarantor_name" text;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "guarantor_id_number" text;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "guarantor_phone" text;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "guarantor_address" text;--> statement-breakpoint
ALTER TABLE "lease_revision" ADD CONSTRAINT "lease_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_revision" ADD CONSTRAINT "lease_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_revision" ADD CONSTRAINT "lease_revision_lease_fk" FOREIGN KEY ("organization_id","lease_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;