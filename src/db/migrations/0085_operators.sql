CREATE TABLE "console"."pilot_goal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"done_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "console"."pilot_goal" ADD CONSTRAINT "pilot_goal_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "console"."subscription"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_goal_subscription_id_position_index" ON "console"."pilot_goal" USING btree ("subscription_id","position");