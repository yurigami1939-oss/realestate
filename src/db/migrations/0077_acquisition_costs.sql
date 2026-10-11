ALTER TABLE "organization_setting" ADD COLUMN "acquisition_costs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "acquisition_costs" jsonb;