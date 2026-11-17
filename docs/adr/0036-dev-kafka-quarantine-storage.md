# ADR-0036. Хранение raw Kafka quarantine в dev

Статус: политика согласована пользователем 2026-11-17. Runtime реализован WMS-505; актуальное evidence — docs/reports/wms-505.md.
Дополняет [ADR-0035](0035-kafka-application-consumers.md). Не меняет запрет
чувствительных данных в operational logs, business audit и обычных CLI responses.
Это узкое исключение к общему запрету хранения чувствительного входа: только
зашифрованная quarantine локального dev-стенда. Production-политика не согласована.

## Согласованное решение

1. Сохраняется decoded Kafka record, полученный KafkaJS: исходные bytes key/value/headers,
   включая NULL и повторяющиеся header values, плюс topic/partition/offset/timestamp.
   Это не сетевой пакет broker; decompression уже выполнена SDK. Нельзя выдавать
   JSON.parse/stringify за сохранение исходных bytes.
2. Raw хранится только зашифрованным AES-256-GCM. Ключ находится в отдельном private
   file вне Git и PostgreSQL. Вместе с ciphertext сохраняются keyId, nonce и auth tag.
   Ключ не попадает в env values, logs, manifests или SQL. Потеря ключа делает raw
   невосстановимым; rotation не должна уничтожать ключи незавершённых записей.
3. Логи, аудит, метрики и обычный inspect возвращают metadata/hash и безопасный
   errorCode, без body/headers/key. Raw driver error/stack не сохраняется как ошибка.
   Доступ к metadata не равен разрешению расшифровать raw.
4. Расшифрованный export — отдельная явная local admin-команда с причиной и аудитом.
   Записывается только новый файл0600, без overwrite/symlink и без body в stdout.
   Оператор отвечает за защищённое хранение и удаление экспортированного файла.
   DB admin без ключа видит только ciphertext.
5. Общий raw-бюджет256MiB; максимум1MiB на запись. Переполнение останавливает обработку
   без offset ack. Исходник нельзя молча обрезать или сохранять plaintext при сбое crypto.
   Quota должна проверяться атомарно между процессами, не через process-local counter.
6. Неразрешённые записи автоматически не удаляются. Разрешённые записи разрешено удалять
   отдельной audited cleanup-командой спустя7дней. Это не обещание вечной доступности
   Kafka: retention broker и сохранность encryption keys учитываются отдельно.
7. Retry перечитывает исходную Kafka-позицию. Он не редактирует raw, eventId, markers,
   consumer cursor и committed offset. Quarantine/DLQ не является business success.
   Unknown schema, gap или неизменившийся poison снова блокируют применение.

## Границы реализации WMS-505

Migration0034, runtime permissions, durable partition blocking/retry budget,
CLI inspect/retry/export/cleanup, AuditService и bounded metrics реализуются по ADR-0037.
Quarantine commit выполняется после rollback business transaction; ошибка сохранения
не разрешает offset ack. Для pending failure должен существовать durable partition gate,
который successor проверяет до обработки последующих records.

Согласование данной политики не является доказательством выполнения этих механизмов.
Статус WMS-505.1–5 определяется runtime tests и актуальным harness evidence, не этим ADR.

## Ручное ревью политики

Проверено соответствие явному ответу пользователя: raw обязателен, plaintext не является
fallback, права export отделены от inspect, quota не допускает truncation, cleanup
не удаляет unresolved, retry не обходит cursor. Source task: docs/tasks/wms-505-policy.json.
Это ручная проверка документа, не автоматический тест encryption/recovery.
