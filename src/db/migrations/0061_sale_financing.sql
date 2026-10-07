CREATE TYPE "public"."financing_source" AS ENUM('own_funds', 'bank_loan', 'islamic_financing', 'cnl_aid', 'fnpos', 'employer', 'other');--> statement-breakpoint
CREATE TABLE "sale_financing" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"source" "financing_source" NOT NULL,
	"expected" bigint NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sale_financing_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_financing_source_key" UNIQUE("organization_id","reservation_id","source"),
	CONSTRAINT "sale_financing_expected" CHECK ("sale_financing"."expected" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "financing_source" "financing_source";--> statement-breakpoint
ALTER TABLE "sale_financing" ADD CONSTRAINT "sale_financing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_financing" ADD CONSTRAINT "sale_financing_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_financing" ADD CONSTRAINT "sale_financing_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;