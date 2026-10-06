CREATE TYPE "public"."partner_kind" AS ENUM('agency', 'introducer');--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "partner_kind" NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"nif" text,
	"rc_number" text,
	"commission_rate_bp" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "partner_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "partner_rate" CHECK ("partner"."commission_rate_bp" between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "partner_commission" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"base" bigint NOT NULL,
	"rate_bp" integer NOT NULL,
	"amount" bigint NOT NULL,
	"earned_on" date NOT NULL,
	"status" "commission_status" DEFAULT 'earned' NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"account_id" uuid,
	"paid_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_commission_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "partner_commission_organizationId_reservationId_unique" UNIQUE("organization_id","reservation_id"),
	CONSTRAINT "partner_commission_amount" CHECK ("partner_commission"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partner"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission" ADD CONSTRAINT "partner_commission_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_commission_organization_id_partner_id_index" ON "partner_commission" USING btree ("organization_id","partner_id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partner"("organization_id","id") ON DELETE no action ON UPDATE no action;