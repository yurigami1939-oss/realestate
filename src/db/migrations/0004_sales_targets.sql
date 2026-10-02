CREATE TABLE "sales_target" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"quotations" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "sales_target_organization_id_user_id_month_pk" PRIMARY KEY("organization_id","user_id","month"),
	CONSTRAINT "sales_target_counts" CHECK ("sales_target"."visits" >= 0 and "sales_target"."quotations" >= 0),
	CONSTRAINT "sales_target_month" CHECK (extract(day from "sales_target"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;