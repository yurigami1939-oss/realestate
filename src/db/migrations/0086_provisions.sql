CREATE TABLE "console"."provision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"legal_name" text NOT NULL,
	"billing_account_id" uuid,
	"plan_id" uuid NOT NULL,
	"program" "console"."subscription_program" DEFAULT 'standard' NOT NULL,
	"pilot_days" integer DEFAULT 30 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"organization_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provision_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "provision_pilot_days" CHECK ("console"."provision"."pilot_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "console"."provision" ADD CONSTRAINT "provision_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."provision" ADD CONSTRAINT "provision_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "console"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."provision" ADD CONSTRAINT "provision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provision_email_index" ON "console"."provision" USING btree ("email");