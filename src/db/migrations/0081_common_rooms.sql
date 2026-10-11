CREATE TYPE "public"."room_booking_status" AS ENUM('requested', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "common_room" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capacity" integer,
	"opens_at" text NOT NULL,
	"closes_at" text NOT NULL,
	"max_hours" integer NOT NULL,
	"needs_approval" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "common_room_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "common_room_hours" CHECK ("common_room"."opens_at" < "common_room"."closes_at"),
	CONSTRAINT "common_room_max_hours" CHECK ("common_room"."max_hours" between 1 and 24)
);
--> statement-breakpoint
CREATE TABLE "room_booking" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"resident_id" uuid,
	"booked_for" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"purpose" text NOT NULL,
	"guests" integer,
	"status" "room_booking_status" DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "room_booking_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "room_booking_period" CHECK ("room_booking"."ends_at" > "room_booking"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "common_room" ADD CONSTRAINT "common_room_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_room" ADD CONSTRAINT "common_room_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_room" ADD CONSTRAINT "common_room_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_room_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."common_room"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_booking" ADD CONSTRAINT "room_booking_resident_fk" FOREIGN KEY ("organization_id","resident_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "common_room_organization_id_residence_id_index" ON "common_room" USING btree ("organization_id","residence_id");--> statement-breakpoint
CREATE INDEX "room_booking_organization_id_room_id_starts_at_index" ON "room_booking" USING btree ("organization_id","room_id","starts_at");