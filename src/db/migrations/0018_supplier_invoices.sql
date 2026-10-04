CREATE TABLE "supplier_invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"category_id" uuid,
	"contract_id" uuid,
	"number" text NOT NULL,
	"invoice_on" date NOT NULL,
	"due_on" date,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"from_reserve" boolean DEFAULT false NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"payment_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "supplier_invoice_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_invoice_amount" CHECK ("supplier_invoice"."amount" > 0),
	CONSTRAINT "supplier_invoice_booking" CHECK ("supplier_invoice"."from_reserve" or "supplier_invoice"."category_id" is not null),
	CONSTRAINT "supplier_invoice_payment" CHECK (("supplier_invoice"."paid_on" is null) = ("supplier_invoice"."payment_method" is null) and ("supplier_invoice"."payment_method" is null or "supplier_invoice"."payment_method" <> 'bank_loan'))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_category_fk" FOREIGN KEY ("organization_id","residence_id","category_id") REFERENCES "public"."charge_category"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_contract_fk" FOREIGN KEY ("organization_id","contract_id") REFERENCES "public"."supplier_contract"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_number_key" ON "supplier_invoice" USING btree ("organization_id","supplier_id","number") WHERE "supplier_invoice"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "supplier_invoice_organization_id_residence_id_invoice_on_index" ON "supplier_invoice" USING btree ("organization_id","residence_id","invoice_on");