ALTER TYPE "public"."document_type" ADD VALUE 'charge_receipt';--> statement-breakpoint
CREATE TABLE "charge_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
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
	CONSTRAINT "charge_payment_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_payment_organizationId_receiptNumber_unique" UNIQUE("organization_id","receipt_number"),
	CONSTRAINT "charge_payment_amount" CHECK ("charge_payment"."amount" > 0),
	CONSTRAINT "charge_payment_method" CHECK ("charge_payment"."method" <> 'bank_loan'),
	CONSTRAINT "charge_payment_cancellation" CHECK (("charge_payment"."status" = 'cancelled') = ("charge_payment"."cancelled_at" is not null and "charge_payment"."cancellation_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charge_payment_organization_id_residence_id_unit_id_index" ON "charge_payment" USING btree ("organization_id","residence_id","unit_id");--> statement-breakpoint
CREATE INDEX "charge_payment_organization_id_paid_on_index" ON "charge_payment" USING btree ("organization_id","paid_on");