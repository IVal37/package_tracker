ALTER TABLE "users" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "setup_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_setup_one_answer" CHECK ("users"."setup_completed_at" is null or "users"."setup_skipped_at" is null);