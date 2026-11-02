CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "shipment_allocation_once" UNIQUE("shipment_id","allocation_id"),
	CONSTRAINT "shipment_line_quantity" CHECK ("shipment_lines"."quantity">0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason_code" text NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_state" CHECK (("shipments"."status" in ('draft','cancelled') and "shipments"."posted_at" is null) or ("shipments"."status"='posted' and "shipments"."posted_at" is not null)),
	CONSTRAINT "shipment_reason" CHECK ("shipments"."reason_code" ~ '^[a-z][a-z0-9.-]{2,63}$')
);
--> statement-breakpoint
CREATE TABLE "shipping_effects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"allocation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_line_id" uuid,
	"target_balance_id" uuid,
	"quantity" integer NOT NULL,
	"audit_id" uuid NOT NULL,
	CONSTRAINT "shipping_effects_shipment_line_id_unique" UNIQUE("shipment_line_id"),
	CONSTRAINT "shipping_effect_shape" CHECK ("shipping_effects"."quantity">0 and (("shipping_effects"."kind"='ship' and "shipping_effects"."shipment_line_id" is not null and "shipping_effects"."target_balance_id" is null) or ("shipping_effects"."kind"='return' and "shipping_effects"."shipment_line_id" is null and "shipping_effects"."target_balance_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "stock_allocations" DROP CONSTRAINT "allocation_quantities";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "order_status";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "movement_receipt_kind";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "movement_transfer_reference";--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "consumed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "shipping_effect_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_effects" ADD CONSTRAINT "shipping_effects_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_effects" ADD CONSTRAINT "shipping_effects_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_effects" ADD CONSTRAINT "shipping_effects_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_effects" ADD CONSTRAINT "shipping_effects_target_balance_id_stock_balances_id_fk" FOREIGN KEY ("target_balance_id") REFERENCES "public"."stock_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_effects" ADD CONSTRAINT "shipping_effects_audit_id_audit_entries_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_shipping_effect_id_shipping_effects_id_fk" FOREIGN KEY ("shipping_effect_id") REFERENCES "public"."shipping_effects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "allocation_quantities" CHECK ("stock_allocations"."allocated">0 and "stock_allocations"."active">=0 and "stock_allocations"."released">=0 and "stock_allocations"."transferred">=0 and "stock_allocations"."consumed">=0 and "stock_allocations"."allocated"::bigint="stock_allocations"."active"::bigint+"stock_allocations"."released"+"stock_allocations"."transferred"+"stock_allocations"."consumed");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_status" CHECK ("orders"."status" in ('draft','active','cancel_pending','cancelled','completed','closed_mixed'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_receipt_kind" CHECK ("stock_movements"."kind" in ('receipt','transfer-out','transfer-in','shipment'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_transfer_reference" CHECK (("stock_movements"."kind"='receipt' and "stock_movements"."transfer_id" is null and "stock_movements"."picking_transfer_id" is null and "stock_movements"."shipping_effect_id" is null)
        or ("stock_movements"."kind"='shipment' and "stock_movements"."transfer_id" is null and "stock_movements"."picking_transfer_id" is null and "stock_movements"."shipping_effect_id" is not null)
        or ("stock_movements"."kind" in ('transfer-out','transfer-in') and
          (("stock_movements"."transfer_id" is not null)::int+("stock_movements"."picking_transfer_id" is not null)::int+("stock_movements"."shipping_effect_id" is not null)::int)=1));