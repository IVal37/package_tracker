CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "shipments_expire_due_idx" ON "shipments" USING btree (coalesce("last_event_at", "created_at")) WHERE "shipments"."archived_at" is null and "shipments"."status" not in ('Delivered', 'Expired');--> statement-breakpoint
CREATE INDEX "shipments_expired_archive_idx" ON "shipments" USING btree (coalesce("last_event_at", "created_at")) WHERE "shipments"."archived_at" is null and "shipments"."status" = 'Expired';