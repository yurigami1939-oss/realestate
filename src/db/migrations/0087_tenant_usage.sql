CREATE TABLE "console"."tenant_usage" (
	"organization_id" uuid NOT NULL,
	"measured_on" date NOT NULL,
	"projects" integer NOT NULL,
	"units" integer NOT NULL,
	"active_units" integer NOT NULL,
	"managed_lots" integer NOT NULL,
	"staff_members" integer NOT NULL,
	"portal_accounts" integer NOT NULL,
	"storage_bytes" bigint NOT NULL,
	"receipts30d" integer NOT NULL,
	"reminders30d" integer NOT NULL,
	"active_members30d" integer NOT NULL,
	"leads30d" integer NOT NULL,
	"last_activity_at" timestamp with time zone,
	CONSTRAINT "tenant_usage_organization_id_measured_on_pk" PRIMARY KEY("organization_id","measured_on")
);
