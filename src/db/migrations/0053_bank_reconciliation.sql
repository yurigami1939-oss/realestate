CREATE TABLE "bank_match" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"entry_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"matched_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_match_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_match_entry_key" UNIQUE("organization_id","account_id","entry_key")
);
--> statement-breakpoint
CREATE TABLE "bank_statement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"from_on" date NOT NULL,
	"to_on" date NOT NULL,
	"line_count" integer NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_statement_account_key" UNIQUE("organization_id","account_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_statement_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"label" text NOT NULL,
	"reference" text,
	"amount" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"dismissal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_line_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_statement_line_account_key" UNIQUE("organization_id","account_id","id"),
	CONSTRAINT "bank_statement_line_fingerprint_key" UNIQUE("organization_id","account_id","fingerprint"),
	CONSTRAINT "bank_statement_line_amount" CHECK ("bank_statement_line"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "bank_match" ADD CONSTRAINT "bank_match_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_match" ADD CONSTRAINT "bank_match_matched_by_user_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_match" ADD CONSTRAINT "bank_match_line_fk" FOREIGN KEY ("organization_id","account_id","line_id") REFERENCES "public"."bank_statement_line"("organization_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_imported_by_user_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."treasury_account"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_statement_fk" FOREIGN KEY ("organization_id","account_id","statement_id") REFERENCES "public"."bank_statement"("organization_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_match_organization_id_line_id_index" ON "bank_match" USING btree ("organization_id","line_id");--> statement-breakpoint
CREATE INDEX "bank_statement_line_organization_id_account_id_booked_on_index" ON "bank_statement_line" USING btree ("organization_id","account_id","booked_on");