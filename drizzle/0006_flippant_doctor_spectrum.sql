CREATE TYPE "public"."notification_kind" AS ENUM('out_for_delivery', 'delivered', 'problem', 'delay');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push_out_for_delivery" boolean DEFAULT true NOT NULL,
	"push_delivered" boolean DEFAULT true NOT NULL,
	"push_problem" boolean DEFAULT true NOT NULL,
	"push_delay" boolean DEFAULT true NOT NULL,
	"email_out_for_delivery" boolean DEFAULT false NOT NULL,
	"email_delivered" boolean DEFAULT true NOT NULL,
	"email_problem" boolean DEFAULT true NOT NULL,
	"email_delay" boolean DEFAULT false NOT NULL,
	"quiet_enabled" boolean DEFAULT false NOT NULL,
	"quiet_start" integer DEFAULT 1320 NOT NULL,
	"quiet_end" integer DEFAULT 420 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_quiet_minutes" CHECK ("notification_settings"."quiet_start" between 0 and 1439 and "notification_settings"."quiet_end" between 0 and 1439)
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"push_sent" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_shipment_kind_key_unique" UNIQUE("shipment_id","kind","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shipments_eta_due_idx" ON "shipments" USING btree ("eta") WHERE "shipments"."archived_at" is null and "shipments"."eta" is not null and "shipments"."status" not in ('Delivered', 'Expired');