CREATE TABLE "staff_pay" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"month" date NOT NULL,
	"base_amount" bigint NOT NULL,
	"bonus" bigint DEFAULT 0 NOT NULL,
	"deduction" bigint DEFAULT 0 NOT NULL,
	"advances" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_pay_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "staff_pay_month_key" UNIQUE("organization_id","staff_id","month"),
	CONSTRAINT "staff_pay_amounts" CHECK ("staff_pay"."base_amount" >= 0 and "staff_pay"."bonus" >= 0 and "staff_pay"."deduction" >= 0 and "staff_pay"."advances" >= 0 and "staff_pay"."net_amount" >= 0),
	CONSTRAINT "staff_pay_net" CHECK ("staff_pay"."net_amount" = "staff_pay"."base_amount" + "staff_pay"."bonus" - "staff_pay"."deduction" - "staff_pay"."advances"),
	CONSTRAINT "staff_pay_payment" CHECK (("staff_pay"."paid_on" is null) = ("staff_pay"."payment_method" is null) and ("staff_pay"."payment_method" is null or "staff_pay"."payment_method" <> 'bank_loan')),
	CONSTRAINT "staff_pay_month" CHECK (extract(day from "staff_pay"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "staff_pay" ADD CONSTRAINT "staff_pay_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay" ADD CONSTRAINT "staff_pay_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay" ADD CONSTRAINT "staff_pay_staff_fk" FOREIGN KEY ("organization_id","staff_id") REFERENCES "public"."staff_member"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_pay_organization_id_month_index" ON "staff_pay" USING btree ("organization_id","month");