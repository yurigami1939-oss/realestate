CREATE TABLE "building_progress" (
	"organization_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"percent" integer NOT NULL,
	CONSTRAINT "building_progress_report_id_building_id_pk" PRIMARY KEY("report_id","building_id"),
	CONSTRAINT "building_progress_percent" CHECK ("building_progress"."percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "construction_report" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reported_on" date NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"body" text,
	"body_ar" text,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "construction_report_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "construction_report_organizationId_projectId_id_unique" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
ALTER TABLE "building_progress" ADD CONSTRAINT "building_progress_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_progress" ADD CONSTRAINT "building_progress_report_fk" FOREIGN KEY ("organization_id","project_id","report_id") REFERENCES "public"."construction_report"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_progress" ADD CONSTRAINT "building_progress_building_fk" FOREIGN KEY ("organization_id","project_id","building_id") REFERENCES "public"."building"("organization_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_report" ADD CONSTRAINT "construction_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_report" ADD CONSTRAINT "construction_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_report" ADD CONSTRAINT "construction_report_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_report" ADD CONSTRAINT "construction_report_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "building_progress_organization_id_building_id_index" ON "building_progress" USING btree ("organization_id","building_id");--> statement-breakpoint
CREATE INDEX "construction_report_organization_id_project_id_reported_on_index" ON "construction_report" USING btree ("organization_id","project_id","reported_on");