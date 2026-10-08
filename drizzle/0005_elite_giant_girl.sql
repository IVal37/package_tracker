CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"retailer" text,
	"retailer_key" text,
	"item" text,
	"order_number" text,
	"shipment_id" uuid,
	"source_email_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_email_id_inbound_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_placeholder_unique" ON "orders" USING btree ("user_id","retailer_key","order_number") WHERE "orders"."shipment_id" is null and "orders"."retailer_key" is not null and "orders"."order_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_shipment_unique" ON "orders" USING btree ("shipment_id") WHERE "orders"."shipment_id" is not null;--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_user_message_unique" ON "inbound_emails" USING btree ("user_id","message_id") WHERE "inbound_emails"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "inbound_emails_pending_idx" ON "inbound_emails" USING btree ("received_at") WHERE "inbound_emails"."parse_status" = 'pending';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_forwarding_alias_lowercase" CHECK ("users"."forwarding_alias" = lower("users"."forwarding_alias"));