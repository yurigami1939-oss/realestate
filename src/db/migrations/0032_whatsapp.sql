CREATE TYPE "public"."whatsapp_kind" AS ENUM('payment_received', 'payment_call', 'payment_reminder', 'handover_appointment', 'charge_call', 'charge_received', 'charge_reminder', 'rent_received', 'announcement', 'assembly_convocation');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_language" AS ENUM('fr', 'ar');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "whatsapp_account" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"phone_number_id" text NOT NULL,
	"business_account_id" text,
	"access_token_encrypted" text NOT NULL,
	"app_secret_encrypted" text,
	"verify_token" text NOT NULL,
	"language" "whatsapp_language" DEFAULT 'fr' NOT NULL,
	"notifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "whatsapp_kind" NOT NULL,
	"recipient" text NOT NULL,
	"recipient_name" text NOT NULL,
	"template" text NOT NULL,
	"language" "whatsapp_language" NOT NULL,
	"params" jsonb NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"status" "whatsapp_status" DEFAULT 'queued' NOT NULL,
	"wamid" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_message_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "tenant_whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "resident" ADD COLUMN "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_message_organization_id_created_at_index" ON "whatsapp_message" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_message_organization_id_wamid_index" ON "whatsapp_message" USING btree ("organization_id","wamid");