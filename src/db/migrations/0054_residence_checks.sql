CREATE TYPE "public"."check_category" AS ENUM('lift', 'fire_safety', 'electricity', 'gas', 'water_tank', 'generator', 'pest_control', 'building', 'other');--> statement-breakpoint
CREATE TYPE "public"."check_kind" AS ENUM('insurance', 'inspection', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."check_result" AS ENUM('compliant', 'remarks', 'non_compliant');--> statement-breakpoint
CREATE TABLE "residence_check" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"kind" "check_kind" NOT NULL,
	"category" "check_category" NOT NULL,
	"title" text NOT NULL,
	"supplier_id" uuid,
	"frequency_months" integer,
	"next_due_on" date NOT NULL,
	"reference" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "residence_check_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "residence_check_frequency" CHECK ("residence_check"."frequency_months" is null or "residence_check"."frequency_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "residence_check_visit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"done_on" date NOT NULL,
	"supplier_id" uuid,
	"result" "check_result" NOT NULL,
	"notes" text,
	"cost" bigint,
	"next_due_on" date NOT NULL,
	"scan_file_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "residence_check_visit_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "residence_check_visit_cost" CHECK ("residence_check_visit"."cost" is null or "residence_check_visit"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "residence_check" ADD CONSTRAINT "residence_check_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check" ADD CONSTRAINT "residence_check_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check" ADD CONSTRAINT "residence_check_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check" ADD CONSTRAINT "residence_check_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check_visit" ADD CONSTRAINT "residence_check_visit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check_visit" ADD CONSTRAINT "residence_check_visit_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check_visit" ADD CONSTRAINT "residence_check_visit_check_fk" FOREIGN KEY ("organization_id","check_id") REFERENCES "public"."residence_check"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check_visit" ADD CONSTRAINT "residence_check_visit_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residence_check_visit" ADD CONSTRAINT "residence_check_visit_scan_fk" FOREIGN KEY ("organization_id","scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "residence_check_organization_id_residence_id_next_due_on_index" ON "residence_check" USING btree ("organization_id","residence_id","next_due_on");--> statement-breakpoint
CREATE INDEX "residence_check_visit_organization_id_check_id_done_on_index" ON "residence_check_visit" USING btree ("organization_id","check_id","done_on");