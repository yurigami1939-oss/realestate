CREATE TYPE "public"."foreign_currency" AS ENUM('EUR', 'USD', 'GBP', 'CAD', 'CHF', 'AED', 'SAR', 'QAR');--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "currency" "foreign_currency";--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "currency_amount" bigint;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_currency" CHECK (("payment"."currency" is null and "payment"."currency_amount" is null) or ("payment"."currency" is not null and "payment"."currency_amount" > 0 and "payment"."method" = 'bank_transfer'));