CREATE TYPE "public"."handover_status" AS ENUM('scheduled', 'signed');--> statement-breakpoint
CREATE TYPE "public"."punch_status" AS ENUM('open', 'lifted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."punch_trade" AS ENUM('masonry', 'plumbing', 'electrical', 'joinery', 'painting', 'tiling', 'waterproofing', 'other');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'handover';--> statement-breakpoint
CREATE TABLE "handover" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"status" "handover_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"notes" text,
	"number" text,
	"signed_on" date,
	"received_by" text,
	"keys_count" integer,
	"electricity_meter" text,
	"gas_meter" text,
	"water_meter" text,
	"outstanding" bigint,
	"reserves" jsonb,
	"observations" text,
	"signed_by" uuid,
	"pdf_file_id" uuid,
	"reserves_closed_on" date,
	"release_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "handover_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "handover_reservation_key" UNIQUE("organization_id","reservation_id"),
	CONSTRAINT "handover_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "handover_signed" CHECK (("handover"."status" = 'signed') = ("handover"."number" is not null and "handover"."signed_on" is not null
        and "handover"."outstanding" is not null and "handover"."reserves" is not null)),
	CONSTRAINT "handover_keys" CHECK ("handover"."keys_count" is null or "handover"."keys_count" >= 0),
	CONSTRAINT "handover_outstanding" CHECK ("handover"."outstanding" is null or "handover"."outstanding" >= 0),
	CONSTRAINT "handover_reserves_closed" CHECK ("handover"."reserves_closed_on" is null or ("handover"."status" = 'signed' and "handover"."reserves_closed_on" >= "handover"."signed_on"))
);
--> statement-breakpoint
CREATE TABLE "punch_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"handover_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"trade" "punch_trade" DEFAULT 'other' NOT NULL,
	"due_on" date,
	"status" "punch_status" DEFAULT 'open' NOT NULL,
	"lifted_on" date,
	"lift_note" text,
	"lifted_by" uuid,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "punch_item_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "punch_item_position" CHECK ("punch_item"."position" > 0),
	CONSTRAINT "punch_item_lifted" CHECK (("punch_item"."status" = 'lifted') = ("punch_item"."lifted_on" is not null)),
	CONSTRAINT "punch_item_cancelled" CHECK (("punch_item"."status" = 'cancelled') = ("punch_item"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_signed_by_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover" ADD CONSTRAINT "handover_release_fk" FOREIGN KEY ("organization_id","release_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_item" ADD CONSTRAINT "punch_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_item" ADD CONSTRAINT "punch_item_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_item" ADD CONSTRAINT "punch_item_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_item" ADD CONSTRAINT "punch_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_item" ADD CONSTRAINT "punch_item_handover_fk" FOREIGN KEY ("organization_id","handover_id") REFERENCES "public"."handover"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handover_organization_id_scheduled_at_index" ON "handover" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "punch_item_organization_id_handover_id_position_index" ON "punch_item" USING btree ("organization_id","handover_id","position");