CREATE TYPE "public"."charge_period_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TABLE "charge_call" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"number" text NOT NULL,
	"due_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"reserve" bigint NOT NULL,
	"resident_id" uuid,
	"addressee_name" text,
	"addressee_name_ar" text,
	"addressee_address" text,
	"pdf_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_call_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_call_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "charge_call_unit_key" UNIQUE("organization_id","period_id","unit_id"),
	CONSTRAINT "charge_call_amounts" CHECK ("charge_call"."amount" > 0 and "charge_call"."reserve" >= 0 and "charge_call"."reserve" <= "charge_call"."amount")
);
--> statement-breakpoint
CREATE TABLE "charge_call_line" (
	"organization_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"category_id" uuid,
	"label" text NOT NULL,
	"label_ar" text,
	"amount" bigint NOT NULL,
	CONSTRAINT "charge_call_line_call_id_position_pk" PRIMARY KEY("call_id","position"),
	CONSTRAINT "charge_call_line_amount" CHECK ("charge_call_line"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "charge_period" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"frequency" charge_frequency NOT NULL,
	"period_index" integer NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"total" bigint NOT NULL,
	"reserve" bigint NOT NULL,
	"call_count" integer NOT NULL,
	"status" charge_period_status DEFAULT 'issued' NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	CONSTRAINT "charge_period_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charge_period_residence_key" UNIQUE("organization_id","residence_id","id"),
	CONSTRAINT "charge_period_index" CHECK ("charge_period"."period_index" between 1 and 12),
	CONSTRAINT "charge_period_dates" CHECK ("charge_period"."due_on" >= "charge_period"."issued_on"),
	CONSTRAINT "charge_period_amounts" CHECK ("charge_period"."total" > 0 and "charge_period"."reserve" >= 0),
	CONSTRAINT "charge_period_cancellation" CHECK (("charge_period"."status" = 'cancelled') = ("charge_period"."cancelled_at" is not null and "charge_period"."cancellation_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "charge_call" ADD CONSTRAINT "charge_call_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call" ADD CONSTRAINT "charge_call_period_fk" FOREIGN KEY ("organization_id","residence_id","period_id") REFERENCES "public"."charge_period"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call" ADD CONSTRAINT "charge_call_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call" ADD CONSTRAINT "charge_call_resident_fk" FOREIGN KEY ("organization_id","resident_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call" ADD CONSTRAINT "charge_call_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call_line" ADD CONSTRAINT "charge_call_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call_line" ADD CONSTRAINT "charge_call_line_call_fk" FOREIGN KEY ("organization_id","call_id") REFERENCES "public"."charge_call"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_call_line" ADD CONSTRAINT "charge_call_line_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."charge_category"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_period" ADD CONSTRAINT "charge_period_budget_fk" FOREIGN KEY ("organization_id","residence_id","budget_id") REFERENCES "public"."budget"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charge_call_organization_id_residence_id_unit_id_index" ON "charge_call" USING btree ("organization_id","residence_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_period_live_key" ON "charge_period" USING btree ("organization_id","budget_id","period_index") WHERE "charge_period"."status" = 'issued';