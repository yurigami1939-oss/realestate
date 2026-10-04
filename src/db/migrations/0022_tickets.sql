CREATE TYPE "public"."ticket_category" AS ENUM('plumbing', 'electricity', 'elevator', 'cleaning', 'security', 'common_areas', 'other');--> statement-breakpoint
CREATE TYPE "public"."ticket_event_kind" AS ENUM('created', 'status', 'assigned', 'comment');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid,
	"resident_id" uuid,
	"reporter_name" text,
	"title" text NOT NULL,
	"description" text,
	"category" "ticket_category" NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"assigned_staff_id" uuid,
	"assigned_supplier_id" uuid,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ticket_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "ticket_assignee" CHECK ("ticket"."assigned_staff_id" is null or "ticket"."assigned_supplier_id" is null)
);
--> statement-breakpoint
CREATE TABLE "ticket_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" "ticket_event_kind" NOT NULL,
	"from_status" "ticket_status",
	"to_status" "ticket_status",
	"assignee" text,
	"comment" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_event_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_resident_fk" FOREIGN KEY ("organization_id","resident_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_staff_fk" FOREIGN KEY ("organization_id","residence_id","assigned_staff_id") REFERENCES "public"."staff_member"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_supplier_fk" FOREIGN KEY ("organization_id","assigned_supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_fk" FOREIGN KEY ("organization_id","ticket_id") REFERENCES "public"."ticket"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_organization_id_residence_id_status_index" ON "ticket" USING btree ("organization_id","residence_id","status");--> statement-breakpoint
CREATE INDEX "ticket_organization_id_status_index" ON "ticket" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ticket_event_organization_id_ticket_id_index" ON "ticket_event" USING btree ("organization_id","ticket_id");