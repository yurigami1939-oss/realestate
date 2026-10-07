CREATE TABLE "reservation_annex" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"list_price" bigint NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_annex_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reservation_annex_price" CHECK ("reservation_annex"."list_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reservation_annex" ADD CONSTRAINT "reservation_annex_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_annex" ADD CONSTRAINT "reservation_annex_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."reservation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_annex" ADD CONSTRAINT "reservation_annex_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_annex_live_key" ON "reservation_annex" USING btree ("organization_id","unit_id") WHERE "reservation_annex"."released_at" is null;--> statement-breakpoint
CREATE INDEX "reservation_annex_organization_id_reservation_id_index" ON "reservation_annex" USING btree ("organization_id","reservation_id");