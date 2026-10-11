CREATE TYPE "public"."mandate_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."owner_statement_status" AS ENUM('issued', 'paid', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'owner_statement';--> statement-breakpoint
CREATE TABLE "management_mandate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"signed_on" date NOT NULL,
	"start_on" date NOT NULL,
	"fee_rate_bp" integer NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"ended_on" date,
	"end_reason" text,
	"ended_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "management_mandate_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "management_mandate_fee" CHECK ("management_mandate"."fee_rate_bp" between 0 and 3000),
	CONSTRAINT "management_mandate_start" CHECK ("management_mandate"."start_on" >= "management_mandate"."signed_on"),
	CONSTRAINT "management_mandate_ended" CHECK (("management_mandate"."status" = 'ended') = ("management_mandate"."ended_on" is not null and "management_mandate"."end_reason" is not null)
        and ("management_mandate"."ended_on" is null or "management_mandate"."ended_on" >= "management_mandate"."start_on"))
);
--> statement-breakpoint
CREATE TABLE "owner_statement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"period_from" date,
	"period_to" date NOT NULL,
	"issued_on" date NOT NULL,
	"collected" bigint NOT NULL,
	"fees" bigint NOT NULL,
	"deductions" bigint NOT NULL,
	"net" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "owner_statement_status" DEFAULT 'issued' NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"payment_reference" text,
	"account_id" uuid,
	"paid_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancelled_by" uuid,
	"pdf_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_statement_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "owner_statement_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "owner_statement_amounts" CHECK ("owner_statement"."net" = "owner_statement"."collected" - "owner_statement"."fees" - "owner_statement"."deductions" and "owner_statement"."net" >= 0
        and "owner_statement"."deductions" >= 0),
	CONSTRAINT "owner_statement_paid" CHECK (("owner_statement"."status" = 'paid') = ("owner_statement"."paid_on" is not null and "owner_statement"."payment_method" is not null)),
	CONSTRAINT "owner_statement_cancelled" CHECK (("owner_statement"."status" = 'cancelled') = ("owner_statement"."cancelled_at" is not null and "owner_statement"."cancellation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "owner_statement_item" (
	"organization_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"rent_payment_id" uuid NOT NULL,
	"reversal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "owner_statement_item_once" UNIQUE("organization_id","rent_payment_id","reversal")
);
--> statement-breakpoint
CREATE TABLE "property_owner" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"id_number" text,
	"phone" text NOT NULL,
	"email" text,
	"address" text,
	"bank" text,
	"rib" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "property_owner_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_owner_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."property_owner"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_mandate" ADD CONSTRAINT "management_mandate_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_owner_fk" FOREIGN KEY ("organization_id","owner_id") REFERENCES "public"."property_owner"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement" ADD CONSTRAINT "owner_statement_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement_item" ADD CONSTRAINT "owner_statement_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement_item" ADD CONSTRAINT "owner_statement_item_statement_fk" FOREIGN KEY ("organization_id","statement_id") REFERENCES "public"."owner_statement"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_statement_item" ADD CONSTRAINT "owner_statement_item_payment_fk" FOREIGN KEY ("organization_id","rent_payment_id") REFERENCES "public"."rent_payment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_mandate_active_unit" ON "management_mandate" USING btree ("organization_id","unit_id") WHERE "management_mandate"."status" = 'active';--> statement-breakpoint
CREATE INDEX "management_mandate_organization_id_owner_id_index" ON "management_mandate" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "owner_statement_organization_id_owner_id_index" ON "owner_statement" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "owner_statement_item_organization_id_statement_id_index" ON "owner_statement_item" USING btree ("organization_id","statement_id");--> statement-breakpoint
CREATE INDEX "property_owner_organization_id_name_index" ON "property_owner" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_mandate_fk" FOREIGN KEY ("organization_id","mandate_id") REFERENCES "public"."management_mandate"("organization_id","id") ON DELETE no action ON UPDATE no action;