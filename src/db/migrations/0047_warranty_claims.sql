CREATE TYPE "public"."warranty_claim_status" AS ENUM('open', 'assigned', 'fixed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."warranty_kind" AS ENUM('completion', 'functioning', 'ten_year');--> statement-breakpoint
CREATE TABLE "warranty_claim" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"handover_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"reported_on" date NOT NULL,
	"reported_by" uuid NOT NULL,
	"from_portal" boolean DEFAULT false NOT NULL,
	"status" "warranty_claim_status" DEFAULT 'open' NOT NULL,
	"warranty_kind" "warranty_kind",
	"supplier_id" uuid,
	"assigned_on" date,
	"due_on" date,
	"fixed_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "warranty_claim_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "warranty_claim_position_key" UNIQUE("organization_id","handover_id","position"),
	CONSTRAINT "warranty_claim_assignment" CHECK (("warranty_claim"."status" in ('assigned', 'fixed')) = ("warranty_claim"."supplier_id" is not null and "warranty_claim"."due_on" is not null)),
	CONSTRAINT "warranty_claim_fixed" CHECK (("warranty_claim"."status" = 'fixed') = ("warranty_claim"."fixed_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_handover_fk" FOREIGN KEY ("organization_id","handover_id") REFERENCES "public"."handover"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warranty_claim_organization_id_status_index" ON "warranty_claim" USING btree ("organization_id","status");