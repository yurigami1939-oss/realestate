CREATE TYPE "public"."gateway_environment" AS ENUM('test', 'production');--> statement-breakpoint
CREATE TYPE "public"."online_payment_purpose" AS ENUM('sale', 'charges');--> statement-breakpoint
CREATE TYPE "public"."online_payment_status" AS ENUM('created', 'pending', 'paid', 'failed', 'expired', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'card';--> statement-breakpoint
CREATE TABLE "online_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" "online_payment_purpose" NOT NULL,
	"reservation_id" uuid,
	"residence_id" uuid,
	"unit_id" uuid,
	"amount" bigint NOT NULL,
	"order_number" text NOT NULL,
	"environment" "gateway_environment" NOT NULL,
	"status" "online_payment_status" DEFAULT 'created' NOT NULL,
	"gateway_order_id" text,
	"form_url" text,
	"user_id" uuid NOT NULL,
	"payer_name" text NOT NULL,
	"locale" text NOT NULL,
	"description" text NOT NULL,
	"gateway_status" smallint,
	"gateway_error" text,
	"gateway_message" text,
	"approval_code" text,
	"card_pan" text,
	"checked_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"payment_id" uuid,
	"charge_payment_id" uuid,
	"issue" text,
	"refunded_at" timestamp with time zone,
	"refunded_by" uuid,
	"refund_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_payment_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "online_payment_organizationId_orderNumber_unique" UNIQUE("organization_id","order_number"),
	CONSTRAINT "online_payment_amount" CHECK ("online_payment"."amount" >= 5000),
	CONSTRAINT "online_payment_target" CHECK (("online_payment"."purpose" = 'sale') = ("online_payment"."reservation_id" is not null) and ("online_payment"."purpose" = 'charges') = ("online_payment"."residence_id" is not null and "online_payment"."unit_id" is not null)),
	CONSTRAINT "online_payment_recorded" CHECK (("online_payment"."payment_id" is null or "online_payment"."purpose" = 'sale') and ("online_payment"."charge_payment_id" is null or "online_payment"."purpose" = 'charges')),
	CONSTRAINT "online_payment_refund" CHECK (("online_payment"."status" = 'refunded') = ("online_payment"."refunded_at" is not null and "online_payment"."refund_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_gateway" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"environment" "gateway_environment" DEFAULT 'test' NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"terminal_id" text NOT NULL,
	"sales_enabled" boolean DEFAULT true NOT NULL,
	"charges_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_charge_payment_fk" FOREIGN KEY ("organization_id","charge_payment_id") REFERENCES "public"."charge_payment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway" ADD CONSTRAINT "payment_gateway_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway" ADD CONSTRAINT "payment_gateway_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_payment_organization_id_created_at_index" ON "online_payment" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "online_payment_organization_id_user_id_index" ON "online_payment" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "online_payment_organization_id_reservation_id_index" ON "online_payment" USING btree ("organization_id","reservation_id");--> statement-breakpoint
CREATE INDEX "online_payment_organization_id_residence_id_unit_id_index" ON "online_payment" USING btree ("organization_id","residence_id","unit_id");