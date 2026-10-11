CREATE TYPE "public"."visitor_status" AS ENUM('expected', 'arrived', 'cancelled');--> statement-breakpoint
CREATE TABLE "visitor_pass" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid,
	"resident_id" uuid,
	"host_name" text NOT NULL,
	"visitor_name" text NOT NULL,
	"people" integer DEFAULT 1 NOT NULL,
	"expected_on" date NOT NULL,
	"code" text,
	"note" text,
	"status" "visitor_status" DEFAULT 'expected' NOT NULL,
	"arrived_at" timestamp with time zone,
	"recorded_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "visitor_pass_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_resident_fk" FOREIGN KEY ("organization_id","resident_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitor_pass_organization_id_residence_id_expected_on_index" ON "visitor_pass" USING btree ("organization_id","residence_id","expected_on");