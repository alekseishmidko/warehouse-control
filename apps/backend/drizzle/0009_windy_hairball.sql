CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "receipt_line_position_unique" UNIQUE("receipt_id","position"),
	CONSTRAINT "receipt_line_product_unique" UNIQUE("receipt_id","product_id"),
	CONSTRAINT "receipt_line_position" CHECK ("receipt_lines"."position" between 1 and 1000),
	CONSTRAINT "receipt_line_quantity" CHECK ("receipt_lines"."quantity" between 1 and 2147483647)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"receiving_location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_event_id" uuid,
	CONSTRAINT "receipts_posted_event_id_unique" UNIQUE("posted_event_id"),
	CONSTRAINT "receipt_state" CHECK (("receipts"."status" = 'draft' and "receipts"."posted_at" is null and "receipts"."posted_event_id" is null) or ("receipts"."status" = 'posted' and "receipts"."posted_at" is not null and "receipts"."posted_event_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_posted_event_id_outbox_events_event_id_fk" FOREIGN KEY ("posted_event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipt_location_warehouse_fk" FOREIGN KEY ("warehouse_id","receiving_location_id") REFERENCES "public"."locations"("warehouse_id","id") ON DELETE no action ON UPDATE no action;