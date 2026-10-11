CREATE TYPE "public"."signed_document" AS ENUM('schedule_amendment', 'lease_inspection');--> statement-breakpoint
CREATE TABLE "e_signature" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type" "signed_document" NOT NULL,
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"document_sha256" text NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "e_signature_organizationId_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "e_signature_signer_key" UNIQUE("organization_id","document_type","document_id","signer_user_id")
);
--> statement-breakpoint
CREATE TABLE "signature_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" "signed_document" NOT NULL,
	"document_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e_signature" ADD CONSTRAINT "e_signature_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_signature" ADD CONSTRAINT "e_signature_signer_user_id_user_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_signature" ADD CONSTRAINT "e_signature_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."file"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_code" ADD CONSTRAINT "signature_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_code" ADD CONSTRAINT "signature_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "e_signature_organization_id_document_type_document_id_index" ON "e_signature" USING btree ("organization_id","document_type","document_id");--> statement-breakpoint
CREATE INDEX "signature_code_organization_id_user_id_document_type_document_id_index" ON "signature_code" USING btree ("organization_id","user_id","document_type","document_id");