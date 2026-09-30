CREATE TYPE "public"."financing_mode" AS ENUM('cash', 'bank_loan', 'mixed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."follow_up_channel" AS ENUM('call', 'whatsapp', 'sms', 'email', 'meeting', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_type" AS ENUM('created', 'updated', 'stage_changed', 'assigned', 'note', 'visit_scheduled', 'visit_updated', 'follow_up_created', 'follow_up_done', 'quotation_issued', 'quotation_cancelled', 'merged');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('facebook', 'instagram', 'whatsapp', 'ouedkniss', 'walk_in', 'referral', 'phone', 'website', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lost_reason" AS ENUM('price', 'financing', 'location', 'typology', 'delivery_date', 'competitor', 'no_response', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('planned', 'done', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "follow_up" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"channel" "follow_up_channel" DEFAULT 'call' NOT NULL,
	"note" text,
	"assigned_to" uuid NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "follow_up_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"phone2" text,
	"email" text,
	"city" text,
	"source" "lead_source" NOT NULL,
	"source_detail" text,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"lost_reason" "lost_reason",
	"lost_note" text,
	"project_id" uuid,
	"typologies" "typology"[] DEFAULT '{}' NOT NULL,
	"budget" bigint,
	"financing" "financing_mode",
	"notes" text,
	"assigned_to" uuid,
	"merged_into_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "lead_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "lead_activity_type" NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"project_id" uuid,
	"unit_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "visit_status" DEFAULT 'planned' NOT NULL,
	"agent_user_id" uuid,
	"notes" text,
	"outcome" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "visit_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up" ADD CONSTRAINT "follow_up_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_merged_into_fk" FOREIGN KEY ("organization_id","merged_into_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_agent_user_id_user_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_up_organization_id_assigned_to_due_at_index" ON "follow_up" USING btree ("organization_id","assigned_to","due_at");--> statement-breakpoint
CREATE INDEX "follow_up_organization_id_lead_id_index" ON "follow_up" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_organization_id_phone_index" ON "lead" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "lead_organization_id_phone2_index" ON "lead" USING btree ("organization_id","phone2");--> statement-breakpoint
CREATE INDEX "lead_organization_id_assigned_to_stage_index" ON "lead" USING btree ("organization_id","assigned_to","stage");--> statement-breakpoint
CREATE INDEX "lead_organization_id_last_activity_at_index" ON "lead" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "lead_activity_organization_id_lead_id_created_at_index" ON "lead_activity" USING btree ("organization_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "visit_organization_id_scheduled_at_index" ON "visit" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "visit_organization_id_lead_id_index" ON "visit" USING btree ("organization_id","lead_id");