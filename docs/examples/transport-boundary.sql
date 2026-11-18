-- WMS-506: read-only снимок границы транспорта для локального оператора.
-- Выполнять при остановленных API/CLI writers, local worker, publisher и consumers.
-- Один SELECT даёт согласованный MVCC snapshot БД. Broker offsets снимаются отдельно
-- при тех же остановленных writers: SQL snapshot не является атомарным DB+Kafka backup.
-- Envelope, credentials, session и raw quarantine в результат не включаются.
with receipt_streams as (
  select s.aggregate_id, s.last_version,
    coalesce(c.last_processed_version,0) as consumer_version,
    coalesce(d.last_completed_version,0) as local_version,
    (select count(*) from processed_events p join outbox_events e using(event_id)
      where p.consumer_name='inventory.putaway' and e.aggregate_type='receipt'
        and e.aggregate_id=s.aggregate_id) as markers
  from outbox_aggregate_sequences s
  left join consumer_streams c on c.consumer_name='inventory.putaway'
    and c.aggregate_type=s.aggregate_type and c.aggregate_id=s.aggregate_id
  left join delivery_streams d on d.destination='inventory.putaway'
    and d.aggregate_type=s.aggregate_type and d.aggregate_id=s.aggregate_id
  where s.aggregate_type='receipt'
), retained_gaps as (
  -- UNIQUE(type,id,version), min=1, count=max=last_version доказывают полный prefix.
  select s.aggregate_type,s.aggregate_id from outbox_aggregate_sequences s
  left join outbox_events e on e.aggregate_type=s.aggregate_type and e.aggregate_id=s.aggregate_id
  group by s.aggregate_type,s.aggregate_id,s.last_version
  having count(e.event_id)<>s.last_version or min(e.aggregate_version)<>1
    or max(e.aggregate_version)<>s.last_version
)
select jsonb_build_object(
  'consumer','inventory.putaway',
  'streams',coalesce((select jsonb_agg(jsonb_build_object(
    'aggregateId',aggregate_id,'lastVersion',last_version::text,
    'consumerCursor',consumer_version::text,'localCursor',local_version::text,
    'markers',markers) order by aggregate_id) from receipt_streams),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object(
    'eventId',event_id,'aggregateType',aggregate_type,'aggregateId',aggregate_id,
    'version',aggregate_version::text) order by aggregate_type,aggregate_id,aggregate_version)
    from outbox_events),'[]'::jsonb),
  -- Только эти receipt events требуют нового application effect. Historical replay
  -- publisher может передать больше записей, но не создаёт новые logical deliveries.
  'pendingEffects',coalesce((select jsonb_agg(e.event_id order by e.aggregate_id,e.aggregate_version)
    from outbox_events e where e.aggregate_type='receipt' and not exists(
      select 1 from processed_events p where p.consumer_name='inventory.putaway' and p.event_id=e.event_id)),'[]'::jsonb),
  'localPending',coalesce((select jsonb_agg(d.event_id order by d.event_id)
    from outbox_deliveries d where d.destination='inventory.putaway' and d.status<>'completed'),'[]'::jsonb),
  'markers',coalesce((select jsonb_agg(jsonb_build_object('consumer',consumer_name,'eventId',event_id)
    order by consumer_name,event_id) from processed_events),'[]'::jsonb),
  'cursors',coalesce((select jsonb_agg(jsonb_build_object('consumer',consumer_name,
    'aggregateType',aggregate_type,'aggregateId',aggregate_id,'version',last_processed_version::text)
    order by consumer_name,aggregate_type,aggregate_id) from consumer_streams),'[]'::jsonb),
  -- Application cursor и transport completion различны. После Kafka commit local
  -- delivery ещё pending; её нельзя объявлять completed только ради красивого backlog.
  'transportStreams',coalesce((select jsonb_agg(jsonb_build_object('destination',destination,
    'aggregateType',aggregate_type,'aggregateId',aggregate_id,'version',last_completed_version::text)
    order by destination,aggregate_type,aggregate_id) from delivery_streams),'[]'::jsonb),
  'deliveries',coalesce((select jsonb_agg(jsonb_build_object('eventId',event_id,
    'destination',destination,'status',status,'attempts',attempts,'retryAttemptBase',retry_attempt_base)
    order by destination,event_id) from outbox_deliveries),'[]'::jsonb),
  'checks',jsonb_build_object(
    'retainedGaps',(select count(*) from retained_gaps),
    -- Cursor должен покрывать ровно prefix markers: одного MAX недостаточно.
    'cursorMismatches',(select count(*) from receipt_streams r where r.consumer_version<>r.markers
      or exists(select 1 from processed_events p join outbox_events e using(event_id)
        where p.consumer_name='inventory.putaway' and e.aggregate_id=r.aggregate_id
          and e.aggregate_type='receipt' and e.aggregate_version>r.consumer_version)),
    'completedWithoutMarker',(select count(*) from outbox_deliveries d where d.destination='inventory.putaway'
      and d.status='completed' and not exists(select 1 from processed_events p
        where p.consumer_name=d.destination and p.event_id=d.event_id)),
    'activeLeases',(select count(*) from outbox_deliveries where status='processing'
      or lease_token is not null or lease_until>clock_timestamp())+
      (select count(*) from delivery_streams where lease_token is not null or lease_until>clock_timestamp()),
    'deadDeliveries',(select count(*) from outbox_deliveries where status='dead'),
    'unresolvedQuarantine',(select count(*) from kafka_quarantine where status<>'resolved'),
    'reserveMismatches',(select count(*) from stock_balances b where b.reserved<>(
      select coalesce(sum(a.active),0) from stock_allocations a where a.balance_id=b.id)),
    'allocationMismatches',(select count(*) from stock_allocations
      where allocated::bigint<>active::bigint+released+transferred+consumed),
    -- Ledger — независимая сторона учёта: shipment/transfer-out уменьшают физический остаток.
    'ledgerMismatches',(select count(*) from stock_balances b where b.on_hand<>(select coalesce(sum(
      case when m.kind in ('shipment','transfer-out') then -m.quantity::bigint else m.quantity::bigint end),0)
      from stock_movements m where m.warehouse_id=b.warehouse_id and m.location_id=b.location_id and m.product_id=b.product_id))
  ),
  -- MD5 здесь только компактная сверка содержимого одинаковых synthetic snapshots,
  -- не authenticity/signature. SHA256 backup вычисляет runner по исходным bytes.
  'inventory',jsonb_build_object(
    'balances',(select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by id),'')) from stock_balances b),
    'allocations',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by id),'')) from stock_allocations a),
    'movements',(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by id),'')) from stock_movements m),
    'tasks',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from putaway_tasks t),
    'taskCount',(select count(*) from putaway_tasks),
    'movementCount',(select count(*) from stock_movements),
    'onHand',(select coalesce(sum(on_hand),0) from stock_balances),
    'reserved',(select coalesce(sum(reserved),0) from stock_balances)
  )
) as boundary;
