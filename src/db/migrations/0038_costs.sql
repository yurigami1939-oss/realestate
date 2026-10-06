CREATE TYPE "public"."cost_category" AS ENUM('land', 'studies', 'works', 'networks', 'fees', 'financial', 'marketing', 'other');--> statement-breakpoint
CREATE TABLE "project_budget_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"category" "cost_category" NOT NULL,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_line_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "project_budget_line_position" UNIQUE("organization_id","project_id","position"),
	CONSTRAINT "project_budget_line_amount" CHECK ("project_budget_line"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "works_contract" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"reference" text,
	"title" text NOT NULL,
	"amount" bigint NOT NULL,
	"retention_bp" integer DEFAULT 500 NOT NULL,
	"signed_on" date NOT NULL,
	"planned_end_on" date,
	"provisional_acceptance_on" date,
	"final_acceptance_on" date,
	"acceptance_notes" text,
	"terminated_on" date,
	"retention_released_on" date,
	"retention_released" bigint,
	"retention_method" "payment_method",
	"retention_reference" text,
	"retention_account_id" uuid,
	"scan_file_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "works_contract_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "works_contract_amount" CHECK ("works_contract"."amount" > 0),
	CONSTRAINT "works_contract_retention" CHECK ("works_contract"."retention_bp" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "works_invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"number" text,
	"invoiced_on" date NOT NULL,
	"due_on" date,
	"label" text,
	"gross" bigint NOT NULL,
	"retention" bigint NOT NULL,
	"net" bigint NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"payment_reference" text,
	"account_id" uuid,
	"scan_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "works_invoice_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "works_invoice_position" UNIQUE("organization_id","contract_id","position"),
	CONSTRAINT "works_invoice_amounts" CHECK ("works_invoice"."gross" > 0 and "works_invoice"."retention" >= 0 and "works_invoice"."net" = "works_invoice"."gross" - "works_invoice"."retention")
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_line" ADD CONSTRAINT "project_budget_line_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_account_fk" FOREIGN KEY ("organization_id","retention_account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_contract" ADD CONSTRAINT "works_contract_scan_fk" FOREIGN KEY ("organization_id","scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_contract_fk" FOREIGN KEY ("organization_id","contract_id") REFERENCES "public"."works_contract"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_invoice" ADD CONSTRAINT "works_invoice_scan_fk" FOREIGN KEY ("organization_id","scan_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "works_contract_organization_id_project_id_index" ON "works_contract" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "works_invoice_organization_id_contract_id_index" ON "works_invoice" USING btree ("organization_id","contract_id");--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;