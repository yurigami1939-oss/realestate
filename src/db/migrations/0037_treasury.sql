CREATE TYPE "public"."movement_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('income', 'expense', 'bank_fee', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."treasury_account_kind" AS ENUM('cash', 'bank', 'ccp');--> statement-breakpoint
CREATE TABLE "cash_count" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"expected" bigint NOT NULL,
	"counted" bigint NOT NULL,
	"difference" bigint NOT NULL,
	"note" text,
	"adjustment_id" uuid,
	"counted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_count_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "cash_count_amounts" CHECK ("cash_count"."counted" >= 0 and "cash_count"."difference" = "cash_count"."counted" - "cash_count"."expected")
);
--> statement-breakpoint
CREATE TABLE "treasury_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "treasury_account_kind" NOT NULL,
	"name" text NOT NULL,
	"bank_name" text,
	"account_number" text,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"opening_on" date NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"closed_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "treasury_account_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "treasury_account_opening" CHECK ("treasury_account"."opening_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_movement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"direction" "movement_direction" NOT NULL,
	"amount" bigint NOT NULL,
	"moved_on" date NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"reference" text,
	"transfer_id" uuid,
	"counter_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	CONSTRAINT "treasury_movement_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "treasury_movement_amount" CHECK ("treasury_movement"."amount" > 0),
	CONSTRAINT "treasury_movement_transfer" CHECK (("treasury_movement"."kind" = 'transfer') = ("treasury_movement"."transfer_id" is not null and "treasury_movement"."counter_account_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "charge_payment" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_counted_by_user_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_adjustment_fk" FOREIGN KEY ("organization_id","adjustment_id") REFERENCES "public"."treasury_movement"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_account" ADD CONSTRAINT "treasury_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_account" ADD CONSTRAINT "treasury_account_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movement" ADD CONSTRAINT "treasury_movement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movement" ADD CONSTRAINT "treasury_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movement" ADD CONSTRAINT "treasury_movement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movement" ADD CONSTRAINT "treasury_movement_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_movement" ADD CONSTRAINT "treasury_movement_counter_fk" FOREIGN KEY ("organization_id","counter_account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_count_organization_id_account_id_counted_on_index" ON "cash_count" USING btree ("organization_id","account_id","counted_on");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_account_one_default" ON "treasury_account" USING btree ("organization_id","kind") WHERE "treasury_account"."is_default" and "treasury_account"."closed_on" is null;--> statement-breakpoint
CREATE INDEX "treasury_movement_organization_id_account_id_moved_on_index" ON "treasury_movement" USING btree ("organization_id","account_id","moved_on");--> statement-breakpoint
CREATE INDEX "treasury_movement_organization_id_transfer_id_index" ON "treasury_movement" USING btree ("organization_id","transfer_id");--> statement-breakpoint
ALTER TABLE "charge_payment" ADD CONSTRAINT "charge_payment_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charge_payment_organization_id_account_id_index" ON "charge_payment" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "rent_payment_organization_id_account_id_index" ON "rent_payment" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "payment_organization_id_account_id_index" ON "payment" USING btree ("organization_id","account_id");