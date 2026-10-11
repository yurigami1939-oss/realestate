CREATE TYPE "public"."sms_provider" AS ENUM('mobilis', 'djezzy', 'ooredoo', 'other');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "sms_account" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" "sms_provider" NOT NULL,
	"api_url" text,
	"sender" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"language" "whatsapp_language" DEFAULT 'fr' NOT NULL,
	"kinds" "whatsapp_kind"[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sms_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "whatsapp_kind",
	"recipient" text NOT NULL,
	"recipient_name" text NOT NULL,
	"text" text NOT NULL,
	"segments" integer NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_message_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "sms_opt_out" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_account" ADD CONSTRAINT "sms_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_account" ADD CONSTRAINT "sms_account_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_opt_out" ADD CONSTRAINT "sms_opt_out_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_opt_out" ADD CONSTRAINT "sms_opt_out_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_message_organization_id_created_at_index" ON "sms_message" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_out_phone" ON "sms_opt_out" USING btree ("organization_id","phone");