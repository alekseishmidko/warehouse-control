CREATE TABLE "putaway_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_receipt_id" uuid NOT NULL,
	"source_receipt_line_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "putaway_tasks_source_receipt_line_id_unique" UNIQUE("source_receipt_line_id"),
	CONSTRAINT "putaway_event_line_unique" UNIQUE("source_event_id","source_receipt_line_id"),
	CONSTRAINT "putaway_pending_status" CHECK ("putaway_tasks"."status" = 'pending'),
	CONSTRAINT "putaway_quantity_range" CHECK ("putaway_tasks"."quantity" between 1 and 2147483647)
);
--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_tasks_audit_id_audit_entries_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_receipt_source_fk" FOREIGN KEY ("source_receipt_id","warehouse_id","source_location_id","source_event_id") REFERENCES "public"."receipts"("id","warehouse_id","receiving_location_id","posted_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "putaway_tasks" ADD CONSTRAINT "putaway_receipt_line_fk" FOREIGN KEY ("source_receipt_id","source_receipt_line_id","product_id","quantity") REFERENCES "public"."receipt_lines"("receipt_id","id","product_id","quantity") ON DELETE no action ON UPDATE no action;