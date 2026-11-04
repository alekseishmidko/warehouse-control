CREATE INDEX "audit_time_page_idx" ON "audit_entries" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_entity_page_idx" ON "audit_entries" USING btree ("entity_type","entity_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "order_warehouse_page_idx" ON "orders" USING btree ("warehouse_id","id");--> statement-breakpoint
CREATE INDEX "picking_order_page_idx" ON "picking_tasks" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "putaway_warehouse_page_idx" ON "putaway_tasks" USING btree ("warehouse_id","created_at","id");--> statement-breakpoint
CREATE INDEX "receipt_warehouse_page_idx" ON "receipts" USING btree ("warehouse_id","created_at","id");--> statement-breakpoint
CREATE INDEX "shipment_order_page_idx" ON "shipments" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "stock_warehouse_page_idx" ON "stock_balances" USING btree ("warehouse_id","id");--> statement-breakpoint
CREATE INDEX "stock_product_page_idx" ON "stock_balances" USING btree ("warehouse_id","product_id","id");--> statement-breakpoint
CREATE INDEX "movement_warehouse_page_idx" ON "stock_movements" USING btree ("warehouse_id","created_at","id");--> statement-breakpoint
CREATE INDEX "movement_product_page_idx" ON "stock_movements" USING btree ("warehouse_id","product_id","created_at","id");