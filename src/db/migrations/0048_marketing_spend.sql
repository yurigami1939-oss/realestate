CREATE TABLE "marketing_spend" (
	"organization_id" uuid NOT NULL,
	"month" date NOT NULL,
	"source" "lead_source" NOT NULL,
	"amount" bigint NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "marketing_spend_organization_id_month_source_pk" PRIMARY KEY("organization_id","month","source"),
	CONSTRAINT "marketing_spend_amount" CHECK ("marketing_spend"."amount" > 0),
	CONSTRAINT "marketing_spend_month" CHECK (extract(day from "marketing_spend"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "marketing_spend" ADD CONSTRAINT "marketing_spend_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_spend" ADD CONSTRAINT "marketing_spend_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;