CREATE TYPE "public"."charge_period_kind" AS ENUM('budget', 'works');--> statement-breakpoint
ALTER TABLE "charge_period" ALTER COLUMN "budget_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_period" ALTER COLUMN "frequency" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_period" ALTER COLUMN "period_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_period" ADD COLUMN "kind" charge_period_kind DEFAULT 'budget' NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_period" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "charge_period" ADD COLUMN "title_ar" text;--> statement-breakpoint
ALTER TABLE "charge_period" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "charge_period" ADD COLUMN "resolution_id" uuid;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."charge_category"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_resolution_fk" FOREIGN KEY ("organization_id","resolution_id") REFERENCES "public"."assembly_resolution"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_kind_fields" CHECK (("charge_period"."kind" = 'budget' and "charge_period"."budget_id" is not null and "charge_period"."frequency" is not null and "charge_period"."period_index" is not null)
        or ("charge_period"."kind" = 'works' and "charge_period"."title" is not null and "charge_period"."category_id" is not null));