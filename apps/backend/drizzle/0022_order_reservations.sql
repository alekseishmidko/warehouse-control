CREATE TABLE "stock_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"allocated" integer NOT NULL,
	"active" integer NOT NULL,
	"released" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "allocation_quantities" CHECK ("stock_allocations"."allocated">0 and "stock_allocations"."active">=0 and "stock_allocations"."released">=0 and "stock_allocations"."allocated"="stock_allocations"."active"+"stock_allocations"."released")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "order_product_unique" UNIQUE("order_id","product_id"),
	CONSTRAINT "order_quantity" CHECK ("order_lines"."quantity" between 1 and 2147483647)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "order_status" CHECK ("orders"."status" in ('draft','active','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_line_id_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_balance_id_stock_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."stock_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;