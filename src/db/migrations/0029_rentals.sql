CREATE TYPE "public"."lease_kind" AS ENUM('residential', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."lease_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."rent_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."rent_payment_kind" AS ENUM('rent', 'deposit');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'lease';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'rent_receipt';--> statement-breakpoint
CREATE TABLE "lease" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "lease_kind" NOT NULL,
	"tenant_name" text NOT NULL,
	"tenant_name_ar" text,
	"tenant_id_number" text,
	"tenant_phone" text NOT NULL,
	"tenant_email" text,
	"tenant_address" text,
	"activity" text,
	"signed_on" date NOT NULL,
	"start_on" date NOT NULL,
	"duration_months" integer NOT NULL,
	"end_on" date NOT NULL,
	"monthly_rent" bigint NOT NULL,
	"monthly_charges" bigint DEFAULT 0 NOT NULL,
	"frequency" "rent_frequency" DEFAULT 'monthly' NOT NULL,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"deposit_carried" bigint DEFAULT 0 NOT NULL,
	"renewed_from_id" uuid,
	"status" "lease_status" DEFAULT 'active' NOT NULL,
	"ended_on" date,
	"end_reason" text,
	"ended_by" uuid,
	"deposit_settled_on" date,
	"deposit_refunded" bigint,
	"deposit_retained" bigint,
	"deposit_retention_reason" text,
	"contract_scan_file_id" uuid,
	"occupant_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "lease_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lease_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "lease_duration" CHECK ("lease"."duration_months" between 1 and 120),
	CONSTRAINT "lease_term" CHECK ("lease"."end_on" >= "lease"."start_on"),
	CONSTRAINT "lease_amounts" CHECK ("lease"."monthly_rent" > 0 and "lease"."monthly_charges" >= 0 and "lease"."deposit" >= 0
        and "lease"."deposit_carried" >= 0),
	CONSTRAINT "lease_ended" CHECK (("lease"."status" = 'ended') = ("lease"."ended_on" is not null and "lease"."end_reason" is not null)),
	CONSTRAINT "lease_deposit_settled" CHECK (("lease"."deposit_settled_on" is null) = ("lease"."deposit_refunded" is null)
        and ("lease"."deposit_settled_on" is null) = ("lease"."deposit_retained" is null)
        and ("lease"."deposit_refunded" is null or "lease"."deposit_refunded" >= 0)
        and ("lease"."deposit_retained" is null or "lease"."deposit_retained" >= 0))
);
--> statement-breakpoint
CREATE TABLE "rent_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" "rent_payment_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text,
	"bank" text,
	"payer_name" text NOT NULL,
	"cheque_cleared_on" date,
	"notes" text,
	"receipt_number" text NOT NULL,
	"allocation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "payment_status" DEFAULT 'valid' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"pdf_file_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_payment_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "rent_payment_organizationId_receiptNumber_unique" UNIQUE("organization_id","receipt_number"),
	CONSTRAINT "rent_payment_amount" CHECK ("rent_payment"."amount" > 0),
	CONSTRAINT "rent_payment_method" CHECK ("rent_payment"."method" <> 'bank_loan'),
	CONSTRAINT "rent_payment_cancellation" CHECK (("rent_payment"."status" = 'cancelled') = ("rent_payment"."cancelled_at" is not null and "rent_payment"."cancellation_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_renewed_from_fk" FOREIGN KEY ("organization_id","renewed_from_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_occupant_fk" FOREIGN KEY ("organization_id","occupant_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_contract_scan_fk" FOREIGN KEY ("organization_id","contract_scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_lease_fk" FOREIGN KEY ("organization_id","lease_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lease_one_active_per_unit" ON "lease" USING btree ("organization_id","unit_id") WHERE "lease"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "lease_renewed_once" ON "lease" USING btree ("organization_id","renewed_from_id") WHERE "lease"."renewed_from_id" is not null;--> statement-breakpoint
CREATE INDEX "lease_organization_id_end_on_index" ON "lease" USING btree ("organization_id","end_on");--> statement-breakpoint
CREATE INDEX "rent_payment_organization_id_lease_id_index" ON "rent_payment" USING btree ("organization_id","lease_id");--> statement-breakpoint
CREATE INDEX "rent_payment_organization_id_paid_on_index" ON "rent_payment" USING btree ("organization_id","paid_on");