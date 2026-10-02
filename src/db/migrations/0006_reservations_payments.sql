CREATE TYPE "public"."commission_status" AS ENUM('earned', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'cheque', 'bank_transfer', 'ccp', 'bank_loan');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('valid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('reserved', 'sold', 'withdrawn');--> statement-breakpoint
CREATE TABLE "commission" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"base" bigint NOT NULL,
	"rate_bp" integer NOT NULL,
	"amount" bigint NOT NULL,
	"earned_on" date NOT NULL,
	"status" "commission_status" DEFAULT 'earned' NOT NULL,
	"paid_on" date,
	"paid_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_organizationId_reservationId_unique" UNIQUE("organization_id","reservation_id")
);
--> statement-breakpoint
CREATE TABLE "commission_rate" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rate_bp" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "commission_rate_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "commission_rate_range" CHECK ("commission_rate"."rate_bp" between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "installment" (
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"share_bp" integer NOT NULL,
	"amount" bigint NOT NULL,
	"trigger" "plan_step_trigger" NOT NULL,
	"months" integer,
	"milestone_id" uuid,
	"due_on" date,
	CONSTRAINT "installment_reservation_id_position_pk" PRIMARY KEY("reservation_id","position"),
	CONSTRAINT "installment_amount" CHECK ("installment"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text,
	"bank" text,
	"payer_name" text NOT NULL,
	"cheque_cleared_on" date,
	"notes" text,
	"status" "payment_status" DEFAULT 'valid' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_amount" CHECK ("payment"."amount" > 0),
	CONSTRAINT "payment_cancellation" CHECK (("payment"."status" = 'cancelled') = ("payment"."cancelled_at" is not null and "payment"."cancellation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid NOT NULL,
	"allocation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "receipt_status" DEFAULT 'issued' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"pdf_file_id" uuid,
	CONSTRAINT "receipt_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "receipt_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "receipt_organizationId_paymentId_unique" UNIQUE("organization_id","payment_id")
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"lead_id" uuid,
	"commercial_user_id" uuid,
	"payment_plan_id" uuid,
	"list_price" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"price" bigint NOT NULL,
	"status" "reservation_status" DEFAULT 'reserved' NOT NULL,
	"reserved_on" date NOT NULL,
	"reservation_notary" text,
	"reservation_reference" text,
	"reservation_scan_file_id" uuid,
	"sale_number" text,
	"sale_signed_on" date,
	"sale_notary" text,
	"sale_reference" text,
	"sale_scan_file_id" uuid,
	"sheet_file_id" uuid,
	"notes" text,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "reservation_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reservation_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "reservation_organizationId_saleNumber_unique" UNIQUE("organization_id","sale_number"),
	CONSTRAINT "reservation_amounts" CHECK ("reservation"."discount" >= 0 and "reservation"."price" = "reservation"."list_price" - "reservation"."discount"),
	CONSTRAINT "reservation_sale" CHECK (("reservation"."status" = 'sold') <= ("reservation"."sale_signed_on" is not null and "reservation"."sale_number" is not null))
);
--> statement-breakpoint
CREATE TABLE "reservation_buyer" (
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "reservation_buyer_reservation_id_buyer_id_pk" PRIMARY KEY("reservation_id","buyer_id"),
	CONSTRAINT "reservation_buyer_position" UNIQUE("reservation_id","position")
);
--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission" ADD CONSTRAINT "commission_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rate" ADD CONSTRAINT "commission_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rate" ADD CONSTRAINT "commission_rate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rate" ADD CONSTRAINT "commission_rate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_milestone_fk" FOREIGN KEY ("organization_id","milestone_id") REFERENCES "public"."construction_milestone"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_commercial_user_id_user_id_fk" FOREIGN KEY ("commercial_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_plan_fk" FOREIGN KEY ("organization_id","payment_plan_id") REFERENCES "public"."payment_plan"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_scan_fk" FOREIGN KEY ("organization_id","reservation_scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_deed_fk" FOREIGN KEY ("organization_id","sale_scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_sheet_fk" FOREIGN KEY ("organization_id","sheet_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_buyer" ADD CONSTRAINT "reservation_buyer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_buyer" ADD CONSTRAINT "reservation_buyer_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_buyer" ADD CONSTRAINT "reservation_buyer_buyer_fk" FOREIGN KEY ("organization_id","buyer_id") REFERENCES "public"."buyer"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_organization_id_user_id_earned_on_index" ON "commission" USING btree ("organization_id","user_id","earned_on");--> statement-breakpoint
CREATE INDEX "installment_organization_id_milestone_id_index" ON "installment" USING btree ("organization_id","milestone_id");--> statement-breakpoint
CREATE INDEX "payment_organization_id_reservation_id_index" ON "payment" USING btree ("organization_id","reservation_id");--> statement-breakpoint
CREATE INDEX "payment_organization_id_paid_on_index" ON "payment" USING btree ("organization_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_one_live_per_unit" ON "reservation" USING btree ("organization_id","unit_id") WHERE "reservation"."status" in ('reserved', 'sold');--> statement-breakpoint
CREATE INDEX "reservation_organization_id_commercial_user_id_index" ON "reservation" USING btree ("organization_id","commercial_user_id");--> statement-breakpoint
CREATE INDEX "reservation_organization_id_lead_id_index" ON "reservation" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "reservation_buyer_organization_id_buyer_id_index" ON "reservation_buyer" USING btree ("organization_id","buyer_id");