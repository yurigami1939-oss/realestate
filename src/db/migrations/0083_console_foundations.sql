CREATE SCHEMA "console";
--> statement-breakpoint
CREATE TYPE "console"."addon_basis" AS ENUM('flat', 'per_managed_lot');--> statement-breakpoint
CREATE TYPE "console"."addon_code" AS ENUM('syndic', 'rentals', 'whatsapp', 'online_payment');--> statement-breakpoint
CREATE TYPE "console"."billing_period" AS ENUM('yearly', 'quarterly');--> statement-breakpoint
CREATE TYPE "console"."document_type" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "console"."subscription_program" AS ENUM('standard', 'design_partner');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pilot', 'active', 'past_due', 'suspended', 'terminated');--> statement-breakpoint
CREATE TABLE "console"."account_organization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_organization_organizationId_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "console"."addon" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" "console"."addon_code" NOT NULL,
	"basis" "console"."addon_basis" NOT NULL,
	"yearly_price" bigint NOT NULL,
	"quarterly_price" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addon_prices" CHECK ("console"."addon"."yearly_price" >= 0 and "console"."addon"."quarterly_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "console"."billing_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"legal_name" text NOT NULL,
	"address" text,
	"wilaya" text,
	"rc_number" text,
	"nif" text,
	"nis" text,
	"ai_number" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"billing_account_id" uuid,
	"organization_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console"."document_sequence" (
	"doc_type" "console"."document_type" NOT NULL,
	"year" smallint NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequence_doc_type_year_pk" PRIMARY KEY("doc_type","year")
);
--> statement-breakpoint
CREATE TABLE "console"."plan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_fr" text NOT NULL,
	"name_ar" text NOT NULL,
	"yearly_price" bigint NOT NULL,
	"quarterly_price" bigint NOT NULL,
	"setup_fee" bigint DEFAULT 0 NOT NULL,
	"modules" text[] DEFAULT '{}' NOT NULL,
	"limits" jsonb NOT NULL,
	"on_quote" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_code_unique" UNIQUE("code"),
	CONSTRAINT "plan_prices" CHECK ("console"."plan"."yearly_price" >= 0 and "console"."plan"."quarterly_price" >= 0 and "console"."plan"."setup_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "console"."subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"program" "console"."subscription_program" DEFAULT 'standard' NOT NULL,
	"activated_at" timestamp with time zone,
	"pilot_ends_on" date,
	"billing_period" "console"."billing_period" DEFAULT 'yearly' NOT NULL,
	"price" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"price_locked_until" date,
	"limit_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"grace_days" integer DEFAULT 15 NOT NULL,
	"status_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_billingAccountId_unique" UNIQUE("billing_account_id"),
	CONSTRAINT "subscription_price" CHECK ("console"."subscription"."price" >= 0),
	CONSTRAINT "subscription_discount" CHECK ("console"."subscription"."discount_bp" between 0 and 10000),
	CONSTRAINT "subscription_grace" CHECK ("console"."subscription"."grace_days" >= 0),
	CONSTRAINT "subscription_period" CHECK ("console"."subscription"."current_period_end" is null or "console"."subscription"."current_period_start" <= "console"."subscription"."current_period_end")
);
--> statement-breakpoint
CREATE TABLE "console"."subscription_addon" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"addon_code" "console"."addon_code" NOT NULL,
	"price" bigint NOT NULL,
	"added_on" date NOT NULL,
	"removed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_addon_price" CHECK ("console"."subscription_addon"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_entitlement" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"status" "subscription_status" NOT NULL,
	"modules" text[] DEFAULT '{}' NOT NULL,
	"limits" jsonb NOT NULL,
	"pilot_ends_on" date,
	"current_period_end" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "console"."account_organization" ADD CONSTRAINT "account_organization_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."account_organization" ADD CONSTRAINT "account_organization_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."audit_log" ADD CONSTRAINT "audit_log_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."subscription" ADD CONSTRAINT "subscription_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "console"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."subscription_addon" ADD CONSTRAINT "subscription_addon_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "console"."subscription"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_entitlement" ADD CONSTRAINT "tenant_entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_organization_billing_account_id_index" ON "console"."account_organization" USING btree ("billing_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addon_live_code" ON "console"."addon" USING btree ("code") WHERE "console"."addon"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "audit_log_billing_account_id_created_at_index" ON "console"."audit_log" USING btree ("billing_account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_index" ON "console"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_addon_live" ON "console"."subscription_addon" USING btree ("subscription_id","addon_code") WHERE "console"."subscription_addon"."removed_on" is null;