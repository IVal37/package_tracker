CREATE TYPE "public"."parse_status" AS ENUM('pending', 'parsed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('Pending', 'InfoReceived', 'InTransit', 'OutForDelivery', 'AttemptFail', 'Delivered', 'AvailableForPickup', 'Exception', 'Expired');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('truck', 'plane', 'ship', 'van', 'pin');--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_order" integer,
	"status" "shipment_status" NOT NULL,
	"message" text,
	"location_text" text,
	"lat" double precision,
	"lng" double precision,
	"mode" "transport_mode",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_shipment_event_unique" UNIQUE("shipment_id","provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" text NOT NULL,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_query_key_unique" UNIQUE("query_key")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tracking_number" text NOT NULL,
	"courier" text,
	"nickname" text,
	"provider" text NOT NULL,
	"provider_tracker_id" text,
	"status" "shipment_status" DEFAULT 'Pending' NOT NULL,
	"eta" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_user_tracking_number_unique" UNIQUE("user_id","tracking_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"forwarding_alias" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_forwarding_alias_unique" UNIQUE("forwarding_alias")
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkpoints_shipment_occurred_idx" ON "checkpoints" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inbound_emails_received_at_idx" ON "inbound_emails" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "shipments_provider_tracker_idx" ON "shipments" USING btree ("provider","provider_tracker_id");