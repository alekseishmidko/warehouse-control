ALTER TABLE "outbox_aggregate_sequences" DROP CONSTRAINT "outbox_sequence_aggregate";--> statement-breakpoint
ALTER TABLE "putaway_tasks" DROP CONSTRAINT "putaway_pending_status";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "movement_receipt_kind";--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD COLUMN "target_location_id" uuid;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD COLUMN "completed_event_id" uuid;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD COLUMN "completion_audit_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_completed_event_id_outbox_events_event_id_fk" FOREIGN KEY ("completed_event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_completion_audit_id_audit_entries_id_fk" FOREIGN KEY ("completion_audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_target_warehouse_fk" FOREIGN KEY ("warehouse_id","target_location_id") REFERENCES "public"."locations"("warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_putaway_tasks_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."putaway_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_transfer_leg_unique" UNIQUE("transfer_id","kind");--> statement-breakpoint
ALTER TABLE "outbox_aggregate_sequences" ADD CONSTRAINT "outbox_sequence_aggregate" CHECK ("outbox_aggregate_sequences"."aggregate_type" in ('receipt','putaway-task'));--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_completion_state" CHECK (("putaway_tasks"."status"='pending' and "putaway_tasks"."target_location_id" is null and "putaway_tasks"."completed_at" is null and "putaway_tasks"."completed_event_id" is null and "putaway_tasks"."completion_audit_id" is null) or ("putaway_tasks"."status"='completed' and "putaway_tasks"."target_location_id" is not null and "putaway_tasks"."target_location_id"<>"putaway_tasks"."source_location_id" and "putaway_tasks"."completed_at" is not null and "putaway_tasks"."completed_event_id" is not null and "putaway_tasks"."completion_audit_id" is not null));--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_pending_status" CHECK ("putaway_tasks"."status" in ('pending','completed'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_transfer_reference" CHECK (("stock_movements"."kind"='receipt' and "stock_movements"."transfer_id" is null) or ("stock_movements"."kind" in ('transfer-out','transfer-in') and "stock_movements"."transfer_id" is not null));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_receipt_kind" CHECK ("stock_movements"."kind" in ('receipt','transfer-out','transfer-in'));