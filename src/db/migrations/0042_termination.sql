CREATE TYPE "public"."reminder_kind" AS ENUM('reminder', 'formal_notice');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_kind" AS ENUM('withdrawal', 'termination');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'terminated';--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "formal_notice_days" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "formal_notices_required" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD COLUMN "termination_retention_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_letter" ADD COLUMN "kind" "reminder_kind" DEFAULT 'reminder' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD COLUMN "kind" "withdrawal_kind" DEFAULT 'withdrawal' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_setting" ADD CONSTRAINT "organization_setting_termination" CHECK ("organization_setting"."formal_notice_days" between 1 and 90
        and "organization_setting"."formal_notices_required" between 1 and 5
        and "organization_setting"."termination_retention_bp" between 0 and 10000);