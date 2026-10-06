ALTER TABLE "lease" ADD COLUMN "deposit_refund_method" "payment_method";--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "deposit_refund_account_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD COLUMN "refund_account_id" uuid;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD COLUMN "payment_method" "payment_method" DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_pay" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_deposit_account_fk" FOREIGN KEY ("organization_id","deposit_refund_account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_refund_account_fk" FOREIGN KEY ("organization_id","refund_account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay" ADD CONSTRAINT "staff_pay_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;