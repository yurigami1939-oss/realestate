CREATE TYPE "public"."bank_loan_status" AS ENUM('preparing', 'submitted', 'approved', 'refused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "bank_loan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"bank" text NOT NULL,
	"requested" bigint NOT NULL,
	"approved" bigint,
	"status" "bank_loan_status" DEFAULT 'preparing' NOT NULL,
	"submitted_on" date,
	"decided_on" date,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bank_loan_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_loan_amounts" CHECK ("bank_loan"."requested" > 0 and ("bank_loan"."approved" is null or "bank_loan"."approved" > 0))
);
--> statement-breakpoint
CREATE TABLE "reservation_transfer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"transferred_on" date NOT NULL,
	"from_buyer_ids" jsonb NOT NULL,
	"to_buyer_ids" jsonb NOT NULL,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_transfer_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "unit_swap" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"from_unit_id" uuid NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"from_price" bigint NOT NULL,
	"to_price" bigint NOT NULL,
	"swapped_on" date NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_swap_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "withdrawal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "withdrawal_status" DEFAULT 'proposed' NOT NULL,
	"reason" text NOT NULL,
	"retention_bp" integer NOT NULL,
	"paid" bigint NOT NULL,
	"retention" bigint NOT NULL,
	"refund" bigint NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"refunded_on" date,
	"refund_method" "payment_method",
	"refund_reference" text,
	"refund_recorded_by" uuid,
	CONSTRAINT "withdrawal_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "withdrawal_amounts" CHECK ("withdrawal"."retention" >= 0 and "withdrawal"."refund" >= 0 and "withdrawal"."retention" + "withdrawal"."refund" = "withdrawal"."paid"),
	CONSTRAINT "withdrawal_retention_bp" CHECK ("withdrawal"."retention_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "bank_loan" ADD CONSTRAINT "bank_loan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_loan" ADD CONSTRAINT "bank_loan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_loan" ADD CONSTRAINT "bank_loan_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_transfer" ADD CONSTRAINT "reservation_transfer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_transfer" ADD CONSTRAINT "reservation_transfer_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_transfer" ADD CONSTRAINT "reservation_transfer_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_swap" ADD CONSTRAINT "unit_swap_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_swap" ADD CONSTRAINT "unit_swap_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_swap" ADD CONSTRAINT "unit_swap_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_swap" ADD CONSTRAINT "unit_swap_from_unit_fk" FOREIGN KEY ("organization_id","from_unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_swap" ADD CONSTRAINT "unit_swap_to_unit_fk" FOREIGN KEY ("organization_id","to_unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_refund_recorded_by_user_id_fk" FOREIGN KEY ("refund_recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_loan_open_key" ON "bank_loan" USING btree ("organization_id","reservation_id") WHERE "bank_loan"."status" not in ('refused', 'cancelled');--> statement-breakpoint
CREATE INDEX "reservation_transfer_organization_id_reservation_id_index" ON "reservation_transfer" USING btree ("organization_id","reservation_id");--> statement-breakpoint
CREATE INDEX "unit_swap_organization_id_reservation_id_index" ON "unit_swap" USING btree ("organization_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_open_key" ON "withdrawal" USING btree ("organization_id","reservation_id") WHERE "withdrawal"."status" <> 'rejected';