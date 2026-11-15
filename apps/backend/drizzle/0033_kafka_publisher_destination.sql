ALTER TABLE "delivery_streams" DROP CONSTRAINT "delivery_stream_destination";--> statement-breakpoint
ALTER TABLE "outbox_deliveries" DROP CONSTRAINT "outbox_delivery_destination";--> statement-breakpoint
ALTER TABLE "delivery_streams" ADD CONSTRAINT "delivery_stream_destination" CHECK ("delivery_streams"."destination" in ('inventory.putaway', 'kafka.publish'));--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_delivery_destination" CHECK ("outbox_deliveries"."destination" in ('inventory.putaway', 'kafka.publish'));