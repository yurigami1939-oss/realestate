CREATE TYPE "public"."access_subject" AS ENUM('lead', 'buyer', 'lease', 'owner');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('whatsapp', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('staff', 'capture', 'stop_reply');--> statement-breakpoint
CREATE TYPE "public"."consent_subject" AS ENUM('lead', 'buyer', 'resident', 'lease');--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" "consent_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"source" "consent_source" NOT NULL,
	"detail" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_type" "access_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"day" date NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access" ADD CONSTRAINT "data_access_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access" ADD CONSTRAINT "data_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_event_organization_id_subject_type_subject_id_index" ON "consent_event" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_access_daily" ON "data_access" USING btree ("organization_id","subject_type","subject_id","user_id","day");