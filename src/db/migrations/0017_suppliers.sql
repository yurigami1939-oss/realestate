CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"activity" text,
	"phone" text,
	"email" text,
	"address" text,
	"nif" text,
	"rc_number" text,
	"rib" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "supplier_organizationId_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_contract" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"residence_id" uuid NOT NULL,
	"category_id" uuid,
	"label" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"annual_amount" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "supplier_contract_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_contract_period" CHECK ("supplier_contract"."end_on" is null or "supplier_contract"."end_on" >= "supplier_contract"."start_on"),
	CONSTRAINT "supplier_contract_amount" CHECK ("supplier_contract"."annual_amount" is null or "supplier_contract"."annual_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."supplier"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_residence_fk" FOREIGN KEY ("organization_id","residence_id") REFERENCES "public"."residence"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_category_fk" FOREIGN KEY ("organization_id","residence_id","category_id") REFERENCES "public"."charge_category"("organization_id","residence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_organization_id_name_index" ON "supplier" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "supplier_contract_organization_id_residence_id_index" ON "supplier_contract" USING btree ("organization_id","residence_id");--> statement-breakpoint
CREATE INDEX "supplier_contract_organization_id_supplier_id_index" ON "supplier_contract" USING btree ("organization_id","supplier_id");