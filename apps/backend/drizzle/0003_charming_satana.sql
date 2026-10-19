CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "location_warehouse_code_unique" UNIQUE("warehouse_id","code"),
	CONSTRAINT "location_warehouse_id_unique" UNIQUE("warehouse_id","id"),
	CONSTRAINT "location_code" CHECK ("locations"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "location_kind" CHECK ("locations"."kind" in ('receiving', 'storage', 'shipping'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_sku_code" CHECK ("products"."sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "product_name_nonempty" CHECK (length(trim("products"."name")) between 1 and 160),
	CONSTRAINT "product_unit_piece" CHECK ("products"."unit" = 'piece')
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_balance_key_unique" UNIQUE("warehouse_id","location_id","product_id"),
	CONSTRAINT "stock_on_hand_range" CHECK ("stock_balances"."on_hand" between 0 and 2147483647),
	CONSTRAINT "stock_reserved_range" CHECK ("stock_balances"."reserved" >= 0 and "stock_balances"."reserved" <= "stock_balances"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text DEFAULT 'receipt' NOT NULL,
	"quantity" integer NOT NULL,
	"audit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "movement_quantity_range" CHECK ("stock_movements"."quantity" between 1 and 2147483647),
	CONSTRAINT "movement_receipt_kind" CHECK ("stock_movements"."kind" = 'receipt')
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code"),
	CONSTRAINT "warehouse_code" CHECK ("warehouses"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "warehouse_name" CHECK (length(trim("warehouses"."name")) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "balance_location_warehouse_fk" FOREIGN KEY ("warehouse_id","location_id") REFERENCES "public"."locations"("warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_audit_id_audit_entries_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "movement_balance_key_fk" FOREIGN KEY ("warehouse_id","location_id","product_id") REFERENCES "public"."stock_balances"("warehouse_id","location_id","product_id") ON DELETE no action ON UPDATE no action;