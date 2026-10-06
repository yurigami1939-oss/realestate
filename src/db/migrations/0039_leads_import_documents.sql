ALTER TYPE "public"."project_document_kind" ADD VALUE 'co_ownership_rules' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."project_document_kind" ADD VALUE 'division_statement' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."project_document_kind" ADD VALUE 'ten_year_insurance' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."project_document_kind" ADD VALUE 'catnat_insurance' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "guarantee_premium" bigint;