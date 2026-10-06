CREATE TABLE "lead_capture_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"source" "lead_source" DEFAULT 'website' NOT NULL,
	"project_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"window_start" timestamp with time zone,
	"window_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "lead_capture_key_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lead_capture_key_hash" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "lead_capture_key" ADD CONSTRAINT "lead_capture_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_capture_key" ADD CONSTRAINT "lead_capture_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_capture_key" ADD CONSTRAINT "lead_capture_key_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_capture_key" ADD CONSTRAINT "lead_capture_key_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;