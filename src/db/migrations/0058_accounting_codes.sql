ALTER TABLE "organization_setting" ADD COLUMN "accounting_codes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "treasury_account" ADD COLUMN "accounting_code" text;--> statement-breakpoint
ALTER TABLE "treasury_account" ADD COLUMN "journal_code" text;