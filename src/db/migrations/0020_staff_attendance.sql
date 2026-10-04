CREATE TYPE "public"."attendance_status" AS ENUM('absent', 'leave', 'sick', 'off');--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"organization_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	CONSTRAINT "staff_attendance_staff_id_day_pk" PRIMARY KEY("staff_id","day")
);
--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_fk" FOREIGN KEY ("organization_id","staff_id") REFERENCES "public"."staff_member"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_attendance_organization_id_day_index" ON "staff_attendance" USING btree ("organization_id","day");