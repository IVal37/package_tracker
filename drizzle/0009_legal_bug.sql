ALTER TABLE "orders" ADD COLUMN "stage" text DEFAULT 'ordered' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "eta_text" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stage_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stage_known" CHECK ("orders"."stage" in ('ordered', 'shipped', 'delivered'));