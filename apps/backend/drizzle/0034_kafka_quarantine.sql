-- WMS-505: одна immutable encrypted source identity и durable partition gate.
-- Offset numeric(20,0) сохраняет Kafka int64 без JS rounding; UUID id нужен для безопасного audit scope.
CREATE TABLE kafka_quarantine (
 id uuid PRIMARY KEY, consumer_name text NOT NULL DEFAULT 'inventory.putaway' CHECK(consumer_name='inventory.putaway'),
 topic text NOT NULL CHECK(topic='warehouse.receiving.events'), partition integer NOT NULL CHECK(partition BETWEEN 0 AND 2),
 source_offset numeric(20,0) NOT NULL CHECK(source_offset BETWEEN 0 AND 9223372036854775807),
 ciphertext text NOT NULL, nonce text NOT NULL, tag text NOT NULL, key_id text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), raw_bytes integer NOT NULL CHECK(raw_bytes BETWEEN 1 AND 1048576),
 event_id uuid, error_code text NOT NULL CHECK(error_code IN ('TRANSIENT_FAILURE','DATABASE_REJECTED','HANDLER_REJECTED','HANDLER_MISSING','CURSOR_MISMATCH','IDENTITY_MISMATCH','INVALID_JSON','INVALID_EVENT','UNSUPPORTED_EVENT','MESSAGE_TOO_LARGE')),
 status text NOT NULL CHECK(status IN ('retry','quarantine','resolved')),
 attempts integer NOT NULL CHECK(attempts>0), retry_base integer NOT NULL DEFAULT 0 CHECK(retry_base>=0 AND retry_base<=attempts),
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(consumer_name,topic,partition,source_offset), CHECK((status='resolved')=(resolved_at IS NOT NULL))
);
CREATE INDEX kafka_quarantine_blocked ON kafka_quarantine(topic,partition,source_offset) WHERE status<>'resolved';
-- Runtime не может менять исходник, identity или ciphertext; квота/cleanup используют один advisory lock.
CREATE FUNCTION kafka_quarantine_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.consumer_name,NEW.topic,NEW.partition,NEW.source_offset,NEW.ciphertext,NEW.nonce,NEW.tag,NEW.key_id,NEW.digest,NEW.raw_bytes,NEW.event_id,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.consumer_name,OLD.topic,OLD.partition,OLD.source_offset,OLD.ciphertext,OLD.nonce,OLD.tag,OLD.key_id,OLD.digest,OLD.raw_bytes,OLD.event_id,OLD.created_at) THEN RAISE EXCEPTION 'quarantine identity immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='resolved' AND NEW.status<>'resolved' THEN RAISE EXCEPTION 'resolved quarantine retained'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='quarantine' AND NEW.status<>'quarantine' AND (NEW.status<>'retry' OR NEW.retry_base<>OLD.attempts OR NEW.retry_base<=OLD.retry_base) THEN RAISE EXCEPTION 'quarantine requires explicit new retry budget'; END IF;
 IF TG_OP='UPDATE' AND NEW.retry_base<>OLD.retry_base AND (OLD.status<>'quarantine' OR NEW.status<>'retry') THEN RAISE EXCEPTION 'retry budget reset requires quarantine'; END IF;
 IF TG_OP='UPDATE' AND (NEW.attempts<OLD.attempts OR NEW.retry_base<OLD.retry_base) THEN RAISE EXCEPTION 'quarantine counters retained'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER kafka_quarantine_immutable BEFORE UPDATE ON kafka_quarantine FOR EACH ROW EXECUTE FUNCTION kafka_quarantine_guard();
REVOKE ALL ON kafka_quarantine FROM PUBLIC;
GRANT SELECT(id,consumer_name,topic,partition,source_offset,digest,raw_bytes,event_id,error_code,status,attempts,retry_base,available_at,created_at,resolved_at),INSERT ON kafka_quarantine TO warehouse_app;
GRANT UPDATE(status,attempts,error_code,available_at,resolved_at) ON kafka_quarantine TO warehouse_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON kafka_quarantine TO warehouse_outbox_admin;
-- INSERT ciphertext доступен runtime. У него нет ключа в БД; обычные API не экспортируют эту таблицу.
-- Назначение и representation полей: raw encrypted, metadata допускается в inspect.
COMMENT ON COLUMN kafka_quarantine.id IS 'UUID записи, без default: сервер randomUUID; audit scope, не eventId';
COMMENT ON COLUMN kafka_quarantine.consumer_name IS 'NOT NULL text, default inventory.putaway, единственный stable logical consumer';
COMMENT ON COLUMN kafka_quarantine.topic IS 'NOT NULL text fixed receipt topic; не пользовательская metric label';
COMMENT ON COLUMN kafka_quarantine.partition IS 'NOT NULL int4 0..2, без default; часть source address';
COMMENT ON COLUMN kafka_quarantine.source_offset IS 'NOT NULL numeric(20,0) Kafka int64 0..MAX; в JS/JSON decimal string, без округления Date/Number';
COMMENT ON COLUMN kafka_quarantine.ciphertext IS 'NOT NULL text base64 AES-256-GCM lossless decoded snapshot; plaintext здесь запрещён';
COMMENT ON COLUMN kafka_quarantine.nonce IS 'NOT NULL text base64 random12 bytes, без default; уникальность nonce обеспечивает CSPRNG';
COMMENT ON COLUMN kafka_quarantine.tag IS 'NOT NULL text base64 GCM16 byte auth tag; source address входит в AAD';
COMMENT ON COLUMN kafka_quarantine.key_id IS 'NOT NULL text encryption key version, без default; ключ в отдельном private file';
COMMENT ON COLUMN kafka_quarantine.digest IS 'NOT NULL text SHA25664 hex исходного snapshot, без default; сверка повторов без plaintext';
COMMENT ON COLUMN kafka_quarantine.raw_bytes IS 'NOT NULL int4 1..1048576 bytes полного encoded snapshot; quota включает resolved до cleanup';
COMMENT ON COLUMN kafka_quarantine.event_id IS 'Nullable UUID из недоверенного envelope, только diagnostic; не является подтверждением валидации или FK';
COMMENT ON COLUMN kafka_quarantine.error_code IS 'NOT NULL allowlisted text code, без default; raw exception message/stack не допускаются';
COMMENT ON COLUMN kafka_quarantine.status IS 'NOT NULL retry/quarantine/resolved, без default; resolved не означает Kafka offset ack';
COMMENT ON COLUMN kafka_quarantine.attempts IS 'NOT NULL int4 >0 committed failures, монотонно; crash до failure commit сюда не входит';
COMMENT ON COLUMN kafka_quarantine.retry_base IS 'NOT NULL int4 default0, последний audited manual budget reset; attempts не сбрасывается';
COMMENT ON COLUMN kafka_quarantine.available_at IS 'NOT NULL timestamptz default now(), DB clock retry deadline; JS Date только для отображения';
COMMENT ON COLUMN kafka_quarantine.created_at IS 'NOT NULL immutable timestamptz default now(), первое durable failure, не source event time';
COMMENT ON COLUMN kafka_quarantine.resolved_at IS 'Nullable timestamptz без default; NOT NULL только resolved, manual cleanup через7дней';
