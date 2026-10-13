CREATE TYPE "console"."payment_method" AS ENUM('bank_transfer', 'cheque', 'ccp', 'card');--> statement-breakpoint
CREATE TYPE "console"."invoice_line_kind" AS ENUM('subscription', 'addon', 'setup', 'adjustment', 'other');--> statement-breakpoint
CREATE TYPE "console"."vat_regime" AS ENUM('vat', 'none');--> statement-breakpoint
CREATE TABLE "console"."payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"method" "console"."payment_method" NOT NULL,
	"reference" text,
	"recorded_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "console_payment_amount" CHECK ("console"."payment"."amount" > 0),
	CONSTRAINT "console_payment_cancel" CHECK (("console"."payment"."cancelled_at" is null) = ("console"."payment"."cancel_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "console"."credit_note" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"amount_ht" bigint NOT NULL,
	"amount_vat" bigint NOT NULL,
	"amount_ttc" bigint NOT NULL,
	"reason" text NOT NULL,
	"pdf_key" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_number_unique" UNIQUE("number"),
	CONSTRAINT "credit_note_amounts" CHECK ("console"."credit_note"."amount_ttc" > 0 and "console"."credit_note"."amount_ht" >= 0 and "console"."credit_note"."amount_vat" >= 0 and "console"."credit_note"."amount_ttc" = "console"."credit_note"."amount_ht" + "console"."credit_note"."amount_vat")
);
--> statement-breakpoint
CREATE TABLE "console"."invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"vat_rate_bp" integer,
	"total_ht" bigint NOT NULL,
	"total_vat" bigint NOT NULL,
	"total_ttc" bigint NOT NULL,
	"pdf_key" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_unique" UNIQUE("number"),
	CONSTRAINT "invoice_totals" CHECK ("console"."invoice"."total_ht" >= 0 and "console"."invoice"."total_vat" >= 0 and "console"."invoice"."total_ttc" = "console"."invoice"."total_ht" + "console"."invoice"."total_vat"),
	CONSTRAINT "invoice_due" CHECK ("console"."invoice"."due_on" >= "console"."invoice"."issued_on")
);
--> statement-breakpoint
CREATE TABLE "console"."invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "console"."invoice_line_kind" NOT NULL,
	"addon_code" "console"."addon_code",
	"label_fr" text NOT NULL,
	"label_ar" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "invoice_line_amount" CHECK ("console"."invoice_line"."quantity" > 0 and "console"."invoice_line"."unit_price" >= 0 and "console"."invoice_line"."amount" = "console"."invoice_line"."quantity" * "console"."invoice_line"."unit_price")
);
--> statement-breakpoint
CREATE TABLE "console"."operator_profile" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"brand" text,
	"legal_form" text,
	"address" text,
	"wilaya" text,
	"phone" text,
	"email" text,
	"rc_number" text,
	"nif" text,
	"nis" text,
	"ai_number" text,
	"bank" text,
	"rib" text,
	"vat_regime" "console"."vat_regime" DEFAULT 'vat' NOT NULL,
	"vat_rate_bp" integer DEFAULT 1900 NOT NULL,
	"payment_terms_days" integer DEFAULT 15 NOT NULL,
	"footer_fr" text,
	"footer_ar" text,
	"logo_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_profile_single" CHECK ("console"."operator_profile"."id" = 1),
	CONSTRAINT "operator_profile_vat" CHECK ("console"."operator_profile"."vat_rate_bp" between 0 and 10000),
	CONSTRAINT "operator_profile_terms" CHECK ("console"."operator_profile"."payment_terms_days" between 0 and 365)
);
--> statement-breakpoint
ALTER TABLE "console"."payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "console"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."payment" ADD CONSTRAINT "payment_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."payment" ADD CONSTRAINT "payment_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."credit_note" ADD CONSTRAINT "credit_note_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "console"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."credit_note" ADD CONSTRAINT "credit_note_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."credit_note" ADD CONSTRAINT "credit_note_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."invoice" ADD CONSTRAINT "invoice_billing_account_id_billing_account_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "console"."billing_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."invoice" ADD CONSTRAINT "invoice_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console"."invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "console"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_invoice_id_index" ON "console"."payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "credit_note_invoice_id_index" ON "console"."credit_note" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_billing_account_id_issued_on_index" ON "console"."invoice" USING btree ("billing_account_id","issued_on");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_id_position_index" ON "console"."invoice_line" USING btree ("invoice_id","position");