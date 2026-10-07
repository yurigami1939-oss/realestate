ALTER TYPE "public"."distribution_key" ADD VALUE 'consumption';--> statement-breakpoint
CREATE TABLE "meter_reading" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"read_on" date NOT NULL,
	"reading" numeric(12, 3) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_reading_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "meter_reading_unit_day" UNIQUE("organization_id","residence_id","unit_id","read_on"),
	CONSTRAINT "meter_reading_positive" CHECK ("meter_reading"."reading" >= 0)
);
--> statement-breakpoint
ALTER TABLE "meter_reading" ADD CONSTRAINT "meter_reading_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_reading" ADD CONSTRAINT "meter_reading_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_reading" ADD CONSTRAINT "meter_reading_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;