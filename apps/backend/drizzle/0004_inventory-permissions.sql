-- WMS-104: минимальные права runtime group и immutable stock movements.
-- Справочники создаются через их сервисы; balance меняет только InventoryService.
GRANT SELECT, INSERT ON TABLE public.products, public.warehouses, public.locations TO warehouse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stock_balances TO warehouse_app;
REVOKE ALL ON TABLE public.stock_movements FROM PUBLIC, warehouse_app;
GRANT SELECT, INSERT ON TABLE public.stock_movements TO warehouse_app;
--> statement-breakpoint
CREATE FUNCTION public.reject_stock_movement_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_stock_movement_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_stock_movement_mutation() TO warehouse_app;
--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.stock_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_stock_movement_mutation();
