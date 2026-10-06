CREATE TYPE "public"."discount_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'discount_requested';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'discount_decided';--> statement-breakpoint
CREATE TABLE "discount_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"list_price" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" "discount_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"approved_amount" bigint,
	"valid_until" date,
	"decision_note" text,
	CONSTRAINT "discount_request_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "discount_request_amounts" CHECK ("discount_request"."amount" > 0 and "discount_request"."amount" <= "discount_request"."list_price"
        and ("discount_request"."approved_amount" is null or ("discount_request"."approved_amount" > 0 and "discount_request"."approved_amount" <= "discount_request"."amount"))),
	CONSTRAINT "discount_request_approval" CHECK (("discount_request"."status" = 'approved') = ("discount_request"."approved_amount" is not null and "discount_request"."valid_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "discount_request" ADD CONSTRAINT "discount_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_request" ADD CONSTRAINT "discount_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_request" ADD CONSTRAINT "discount_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_request" ADD CONSTRAINT "discount_request_lead_fk" FOREIGN KEY ("organization_id","lead_id") REFERENCES "public"."lead"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_request" ADD CONSTRAINT "discount_request_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_request_one_pending" ON "discount_request" USING btree ("organization_id","lead_id","unit_id") WHERE "discount_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "discount_request_organization_id_status_index" ON "discount_request" USING btree ("organization_id","status");