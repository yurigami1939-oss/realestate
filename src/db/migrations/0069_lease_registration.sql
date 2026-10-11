ALTER TABLE "lease" ADD COLUMN "registered_on" date;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "registration_office" text;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "registration_reference" text;--> statement-breakpoint
ALTER TABLE "lease" ADD COLUMN "registration_duty" bigint;--> statement-breakpoint
ALTER TABLE "lease" ADD CONSTRAINT "lease_registration" CHECK (("lease"."registered_on" is null) = ("lease"."registration_office" is null)
        and ("lease"."registered_on" is null) = ("lease"."registration_reference" is null)
        and ("lease"."registered_on" is null) = ("lease"."registration_duty" is null)
        and ("lease"."registered_on" is null or "lease"."registered_on" >= "lease"."signed_on")
        and ("lease"."registration_duty" is null or "lease"."registration_duty" >= 0));