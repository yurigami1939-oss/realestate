ALTER TABLE "sales_target" DROP CONSTRAINT "sales_target_counts";--> statement-breakpoint
ALTER TABLE "sales_target" ADD COLUMN "reservations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_target" ADD COLUMN "sales" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_counts" CHECK ("sales_target"."visits" >= 0 and "sales_target"."quotations" >= 0 and "sales_target"."reservations" >= 0 and "sales_target"."sales" >= 0);