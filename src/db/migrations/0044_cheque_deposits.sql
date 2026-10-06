CREATE TYPE "public"."cheque_source" AS ENUM('sale', 'charges', 'rent');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'cheque_deposit';--> statement-breakpoint
CREATE TABLE "cheque_deposit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"account_id" uuid NOT NULL,
	"deposited_on" date NOT NULL,
	"total" bigint NOT NULL,
	"count" integer NOT NULL,
	"cleared_on" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pdf_file_id" uuid,
	CONSTRAINT "cheque_deposit_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "cheque_deposit_organizationId_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "cheque_deposit_amounts" CHECK ("cheque_deposit"."total" > 0 and "cheque_deposit"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "cheque_deposit_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deposit_id" uuid NOT NULL,
	"source" "cheque_source" NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"cheque_number" text,
	"bank" text,
	"payer_name" text NOT NULL,
	"received_on" date NOT NULL,
	CONSTRAINT "cheque_deposit_item_once" UNIQUE("organization_id","source","payment_id"),
	CONSTRAINT "cheque_deposit_item_amount" CHECK ("cheque_deposit_item"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cheque_deposit" ADD CONSTRAINT "cheque_deposit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_deposit" ADD CONSTRAINT "cheque_deposit_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_deposit" ADD CONSTRAINT "cheque_deposit_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_deposit" ADD CONSTRAINT "cheque_deposit_pdf_fk" FOREIGN KEY ("organization_id","pdf_file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_deposit_item" ADD CONSTRAINT "cheque_deposit_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_deposit_item" ADD CONSTRAINT "cheque_deposit_item_deposit_fk" FOREIGN KEY ("organization_id","deposit_id") REFERENCES "public"."cheque_deposit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cheque_deposit_organization_id_account_id_index" ON "cheque_deposit" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE INDEX "cheque_deposit_item_organization_id_deposit_id_index" ON "cheque_deposit_item" USING btree ("organization_id","deposit_id");