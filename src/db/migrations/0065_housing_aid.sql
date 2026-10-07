CREATE TYPE "public"."housing_program" AS ENUM('free', 'lpa');--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "household_income" bigint;--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "owns_home" boolean;--> statement-breakpoint
ALTER TABLE "buyer" ADD COLUMN "previous_housing_aid" boolean;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "housing_program" "housing_program" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_loan" ADD COLUMN "subsidized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_loan" ADD COLUMN "rate_bp" integer;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "housing_aid" jsonb DEFAULT '{}'::jsonb NOT NULL;