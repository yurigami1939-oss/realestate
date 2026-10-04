CREATE TYPE "public"."staff_role" AS ENUM('security', 'cleaning', 'maintenance', 'gardener', 'concierge', 'other');--> statement-breakpoint
CREATE TABLE "salary_advance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"month" date NOT NULL,
	"amount" bigint NOT NULL,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "salary_advance_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "salary_advance_amount" CHECK ("salary_advance"."amount" > 0),
	CONSTRAINT "salary_advance_month" CHECK (extract(day from "salary_advance"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "staff_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name_ar" text,
	"first_name_ar" text,
	"phone" text,
	"nin" text,
	"hired_on" date NOT NULL,
	"left_on" date,
	"monthly_salary" bigint NOT NULL,
	"category_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "staff_member_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "staff_member_residence_key" UNIQUE("organization_id","residence_id","id"),
	CONSTRAINT "staff_member_period" CHECK ("staff_member"."left_on" is null or "staff_member"."left_on" >= "staff_member"."hired_on"),
	CONSTRAINT "staff_member_salary" CHECK ("staff_member"."monthly_salary" >= 0)
);
--> statement-breakpoint
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_advance" ADD CONSTRAINT "salary_advance_staff_fk" FOREIGN KEY ("organization_id","staff_id") REFERENCES "public"."staff_member"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_category_fk" FOREIGN KEY ("organization_id","residence_id","category_id") REFERENCES "public"."charge_category"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_advance_organization_id_staff_id_month_index" ON "salary_advance" USING btree ("organization_id","staff_id","month");--> statement-breakpoint
CREATE INDEX "staff_member_organization_id_residence_id_index" ON "staff_member" USING btree ("organization_id","residence_id");