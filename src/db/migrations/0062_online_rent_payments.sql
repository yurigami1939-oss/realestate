ALTER TYPE "public"."online_payment_purpose" ADD VALUE 'rent';--> statement-breakpoint
ALTER TABLE "online_payment" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "online_payment" ADD COLUMN "rent_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_gateway" ADD COLUMN "rent_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_lease_fk" FOREIGN KEY ("organization_id","lease_id") REFERENCES "public"."lease"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_rent_payment_fk" FOREIGN KEY ("organization_id","rent_payment_id") REFERENCES "public"."rent_payment"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_payment_organization_id_lease_id_index" ON "online_payment" USING btree ("organization_id","lease_id");--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_lease" CHECK (("online_payment"."purpose"::text = 'rent') = ("online_payment"."lease_id" is not null));--> statement-breakpoint
ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_rent_recorded" CHECK ("online_payment"."rent_payment_id" is null or "online_payment"."purpose"::text = 'rent');