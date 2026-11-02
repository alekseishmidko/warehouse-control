-- Review WMS-206: immutable состав shipment включает запрет INSERT после транзакции создания.
-- INSERT header/lines выполняется одним production runner без вложенных savepoints.
-- Системный xmin используется только как DB-признак создающей транзакции, не передаётся в API.
CREATE FUNCTION public.guard_shipment_line_creation_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header_xid xid;
BEGIN
 SELECT xmin INTO header_xid FROM public.shipments WHERE id=NEW.shipment_id;
 IF FOUND AND header_xid <> pg_current_xact_id()::xid THEN
  RAISE EXCEPTION 'Shipment composition is immutable after creation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Старый shipment_line_insert продолжает проверять shipping/order/quantity и лимит строк.
-- Новая проверка не отменяет FK и не разрешает line без существующего draft header.
CREATE TRIGGER shipment_line_creation_transaction
 BEFORE INSERT ON public.shipment_lines FOR EACH ROW
 EXECUTE FUNCTION public.guard_shipment_line_creation_transaction();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_shipment_line_creation_transaction() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_shipment_line_creation_transaction() TO warehouse_app;
