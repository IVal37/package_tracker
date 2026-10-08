ALTER TABLE "places" ALTER COLUMN "lat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ALTER COLUMN "lng" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "geocoder" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "destination_text" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "destination_key" text GENERATED ALWAYS AS (nullif(lower(regexp_replace(trim(destination_text), '[[:space:]]+', ' ', 'g')), '')) STORED;--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN "lat";--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN "lng";--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_lat_lng_both_or_neither" CHECK (("places"."lat" is null) = ("places"."lng" is null));--> statement-breakpoint
DROP TYPE "public"."transport_mode";