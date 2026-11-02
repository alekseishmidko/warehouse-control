CREATE TABLE "picking_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"planned" integer NOT NULL,
	"picked_total" integer DEFAULT 0 NOT NULL,
	"cancelled_unpicked" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "picking_line_quantity" CHECK ("picking_lines"."planned">0 and "picking_lines"."picked_total">=0 and "picking_lines"."cancelled_unpicked">=0 and "picking_lines"."picked_total"::bigint+"picking_lines"."cancelled_unpicked"<="picking_lines"."planned")
);
--> statement-breakpoint
CREATE TABLE "picking_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"assignee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picking_status" CHECK ("picking_tasks"."status" in ('ready','in_progress','shortage','completed','cancelled')),
	CONSTRAINT "picking_assignee" CHECK ("picking_tasks"."status" in ('ready','cancelled') or "picking_tasks"."assignee_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "picking_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_line_id" uuid NOT NULL,
	"source_allocation_id" uuid NOT NULL,
	"target_allocation_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"audit_id" uuid NOT NULL,
	CONSTRAINT "picking_transfers_target_allocation_id_unique" UNIQUE("target_allocation_id"),
	CONSTRAINT "picking_transfer_quantity" CHECK ("picking_transfers"."quantity">0)
);
--> statement-breakpoint
ALTER TABLE "stock_allocations" DROP CONSTRAINT "allocation_quantities";--> statement-breakpoint
ALTER TABLE "outbox_aggregate_sequences" DROP CONSTRAINT "outbox_sequence_aggregate";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "movement_transfer_reference";--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "transferred" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "picking_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "picking_lines" ADD CONSTRAINT "picking_lines_task_id_picking_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."picking_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_lines" ADD CONSTRAINT "picking_lines_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_tasks" ADD CONSTRAINT "picking_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_transfers" ADD CONSTRAINT "picking_transfers_task_line_id_picking_lines_id_fk" FOREIGN KEY ("task_line_id") REFERENCES "public"."picking_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_transfers" ADD CONSTRAINT "picking_transfers_source_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("source_allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_transfers" ADD CONSTRAINT "picking_transfers_target_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("target_allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_transfers" ADD CONSTRAINT "picking_transfers_audit_id_audit_entries_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "picking_source_once" ON "picking_lines" USING btree ("task_id","allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_picking_task" ON "picking_tasks" USING btree ("order_id") WHERE "picking_tasks"."status" in ('ready','in_progress','shortage');--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_picking_transfer_id_picking_transfers_id_fk" FOREIGN KEY ("picking_transfer_id") REFERENCES "public"."picking_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "allocation_quantities" CHECK ("stock_allocations"."allocated">0 and "stock_allocations"."active">=0 and "stock_allocations"."released">=0 and "stock_allocations"."transferred">=0 and "stock_allocations"."allocated"::bigint="stock_allocations"."active"::bigint+"stock_allocations"."released"+"stock_allocations"."transferred");--> statement-breakpoint
ALTER TABLE "outbox_aggregate_sequences" ADD CONSTRAINT "outbox_sequence_aggregate" CHECK ("outbox_aggregate_sequences"."aggregate_type" in ('receipt','putaway-task','order','picking-task'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_transfer_reference" CHECK (("stock_movements"."kind"='receipt' and "stock_movements"."transfer_id" is null and "stock_movements"."picking_transfer_id" is null) or ("stock_movements"."kind" in ('transfer-out','transfer-in') and (("stock_movements"."transfer_id" is not null and "stock_movements"."picking_transfer_id" is null) or ("stock_movements"."transfer_id" is null and "stock_movements"."picking_transfer_id" is not null))));