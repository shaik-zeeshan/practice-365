CREATE TYPE "public"."activity_category_type" AS ENUM('time_entry', 'expense');--> statement-breakpoint
CREATE TYPE "public"."activity_tax_treatment" AS ENUM('default', 'none');--> statement-breakpoint
CREATE TABLE "activity_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"type" "activity_category_type" NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"rate" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"tax_treatment" "activity_tax_treatment" DEFAULT 'default' NOT NULL,
	"permission_groups" text DEFAULT 'Everyone' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "activity_category_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_categories" ADD CONSTRAINT "activity_categories_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activity_category_id_activity_categories_id_fk" FOREIGN KEY ("activity_category_id") REFERENCES "public"."activity_categories"("id") ON DELETE no action ON UPDATE no action;