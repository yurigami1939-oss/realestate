CREATE TABLE "portal_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"buyer_id" uuid,
	"resident_id" uuid,
	"invitation_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "portal_link_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "portal_link_target" CHECK (("portal_link"."buyer_id" is null) <> ("portal_link"."resident_id" is null))
);
--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_buyer_fk" FOREIGN KEY ("organization_id","buyer_id") REFERENCES "public"."buyer"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link" ADD CONSTRAINT "portal_link_resident_fk" FOREIGN KEY ("organization_id","resident_id") REFERENCES "public"."resident"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_link_buyer_key" ON "portal_link" USING btree ("organization_id","buyer_id") WHERE "portal_link"."revoked_at" is null and "portal_link"."buyer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_link_resident_key" ON "portal_link" USING btree ("organization_id","resident_id") WHERE "portal_link"."revoked_at" is null and "portal_link"."resident_id" is not null;--> statement-breakpoint
CREATE INDEX "portal_link_organization_id_user_id_index" ON "portal_link" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "portal_link_organization_id_email_index" ON "portal_link" USING btree ("organization_id","email");