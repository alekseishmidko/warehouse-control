# 0032. Dev Kafka topology без смены транспорта

Статус: принято в рамках WMS-501. Уточняет dev развёртывание ADR-0001 и будущий
Kafka transport; не заменяет transactional outbox/worker решения ADR-0012/0015.

Контекст: нужен воспроизводимый Kafka стенд до реализации publisher и consumers.
Решение: отдельный Strimzi 1.3.1 / Kafka 4.3.2, KRaft combined single broker/controller,
PVC 2Gi, internal mTLS и exact ACL. Receipt stream — warehouse.receiving.events,
3 partitions, RF/minISR=1, key canonical aggregateId; logical group inventory.putaway
совпадает с DB marker owner. Версия schema не меняет topic/key.

Последствия: рестарт Pod сохраняет log, удаление node/disk не защищено. Retention
может удалить Kafka log до восстановления consumer; cursor/replay policy обязательна.
Изменение partitions без persisted routing/плана нового поколения запрещено.
Приложение пока не подключается к Kafka. Последующие этапы должны проверить broker
ack, дубликаты, последовательность, offset-after-commit и cutover отдельно.

Владельцы подробностей: [platform README](../../infra/kafka/README.md),
[AC/evidence](../reports/wms-501.md).
