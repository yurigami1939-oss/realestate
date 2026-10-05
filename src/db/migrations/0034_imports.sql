ALTER TABLE "payment" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "legacy_receipt" text;