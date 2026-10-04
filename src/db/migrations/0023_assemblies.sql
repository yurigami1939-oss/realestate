CREATE TYPE "public"."assembly_attendance_kind" AS ENUM('present', 'represented', 'absent');--> statement-breakpoint
CREATE TYPE "public"."assembly_kind" AS ENUM('ordinary', 'extraordinary');--> statement-breakpoint
CREATE TYPE "public"."assembly_status" AS ENUM('draft', 'convened', 'closed');--> statement-breakpoint
CREATE TYPE "public"."majority" AS ENUM('simple', 'absolute', 'two_thirds', 'unanimity');--> statement-breakpoint
CREATE TYPE "public"."vote_choice" AS ENUM('for', 'against', 'abstain');--> statement-breakpoint
CREATE TABLE "assembly_attendance" (
	"organization_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" "assembly_attendance_kind" NOT NULL,
	"co_owner_name" text,
	"proxy_name" text,
	"share" integer NOT NULL,
	CONSTRAINT "assembly_attendance_assembly_id_unit_id_pk" PRIMARY KEY("assembly_id","unit_id"),
	CONSTRAINT "assembly_attendance_proxy" CHECK ("assembly_attendance"."kind" = 'represented' or "assembly_attendance"."proxy_name" is null)
);
--> statement-breakpoint
CREATE TABLE "assembly_resolution" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"description" text,
	"majority" "majority" DEFAULT 'simple' NOT NULL,
	"shares_for" integer,
	"shares_against" integer,
	"shares_abstain" integer,
	"adopted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "assembly_resolution_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "assembly_resolution_assembly_key" UNIQUE("organization_id","assembly_id","id")
);
--> statement-breakpoint
CREATE TABLE "assembly_vote" (
	"organization_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"resolution_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"choice" "vote_choice" NOT NULL,
	CONSTRAINT "assembly_vote_resolution_id_unit_id_pk" PRIMARY KEY("resolution_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "general_assembly" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"kind" "assembly_kind" DEFAULT 'ordinary' NOT NULL,
	"held_on" date NOT NULL,
	"start_time" text NOT NULL,
	"place" text NOT NULL,
	"status" "assembly_status" DEFAULT 'draft' NOT NULL,
	"total_shares" integer,
	"chair_name" text,
	"secretary_name" text,
	"notes" text,
	"convened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"convocation_file_id" uuid,
	"minutes_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "general_assembly_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "general_assembly_residence_key" UNIQUE("organization_id","residence_id","id"),
	CONSTRAINT "general_assembly_closed" CHECK (("general_assembly"."status" = 'closed') = ("general_assembly"."closed_at" is not null and "general_assembly"."total_shares" is not null))
);
--> statement-breakpoint
ALTER TABLE "assembly_attendance" ADD CONSTRAINT "assembly_attendance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_attendance" ADD CONSTRAINT "assembly_attendance_assembly_fk" FOREIGN KEY ("organization_id","residence_id","assembly_id") REFERENCES "public"."general_assembly"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_attendance" ADD CONSTRAINT "assembly_attendance_unit_fk" FOREIGN KEY ("residence_id","unit_id") REFERENCES "public"."residence_unit"("residence_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_resolution" ADD CONSTRAINT "assembly_resolution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_resolution" ADD CONSTRAINT "assembly_resolution_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_resolution" ADD CONSTRAINT "assembly_resolution_assembly_fk" FOREIGN KEY ("organization_id","assembly_id") REFERENCES "public"."general_assembly"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_vote" ADD CONSTRAINT "assembly_vote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_vote" ADD CONSTRAINT "assembly_vote_resolution_fk" FOREIGN KEY ("organization_id","assembly_id","resolution_id") REFERENCES "public"."assembly_resolution"("organization_id","assembly_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_vote" ADD CONSTRAINT "assembly_vote_attendance_fk" FOREIGN KEY ("assembly_id","unit_id") REFERENCES "public"."assembly_attendance"("assembly_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_assembly" ADD CONSTRAINT "general_assembly_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_assembly" ADD CONSTRAINT "general_assembly_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_assembly" ADD CONSTRAINT "general_assembly_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_assembly" ADD CONSTRAINT "general_assembly_convocation_fk" FOREIGN KEY ("organization_id","convocation_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_assembly" ADD CONSTRAINT "general_assembly_minutes_fk" FOREIGN KEY ("organization_id","minutes_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assembly_resolution_organization_id_assembly_id_index" ON "assembly_resolution" USING btree ("organization_id","assembly_id");--> statement-breakpoint
CREATE INDEX "general_assembly_organization_id_residence_id_held_on_index" ON "general_assembly" USING btree ("organization_id","residence_id","held_on");