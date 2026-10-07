CREATE TABLE "lease_charge_settlement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"provisions" bigint NOT NULL,
	"actual" bigint NOT NULL,
	"balance" bigint NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "lease_charge_settlement_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "lease_charge_settlement_amounts" CHECK ("lease_charge_settlement"."provisions" >= 0 and "lease_charge_settlement"."actual" >= 0 and "lease_charge_settlement"."balance" = "lease_charge_settlement"."actual" - "lease_charge_settlement"."provisions")
);
--> statement-breakpoint
ALTER TABLE "lease_charge_settlement" ADD CONSTRAINT "lease_charge_settlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_charge_settlement" ADD CONSTRAINT "lease_charge_settlement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_charge_settlement" ADD CONSTRAINT "lease_charge_settlement_lease_fk" FOREIGN KEY ("organization_id","lease_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lease_charge_settlement_live_key" ON "lease_charge_settlement" USING btree ("organization_id","lease_id","year") WHERE "lease_charge_settlement"."cancelled_at" is null;