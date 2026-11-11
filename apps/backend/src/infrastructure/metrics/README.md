# Метрики процесса WMS-402

## Бизнес-назначение

Оператор видит latency HTTP, отказы, pool pressure и backlog outbox. Метрика не
заменяет AuditService или проверку складского остатка. Warehouse/user/document UUID
и произвольные URL в labels не принимаются.

## Устройство и взаимодействие

`runtime-metrics.ts` — process-local pull adapter. Общий logging owner запускает его
только при явном WMS_METRICS_PORT; без настройки listener не создаётся. CLI не открывает
порт. WMS_METRICS_HOST по умолчанию loopback; Compose overlay задаёт0.0.0.0 только
во внутренней сети. Метрики не публикуются через warehouse Service/API ingress.
`stopMetrics` прекращает scrape на SIGTERM/SIGINT до закрытия pool.

HTTP и worker counters наблюдают выбранное событие до попытки записи sink, после
транзакционного буфера WMS-401. Они не зависят от доступности Loki. HTTP histogram
использует секунды и фиксированные buckets10ms..30s, считает реальные итоговые события
HTTP middleware. Счётчики фиксированы каталогом LOG_EVENTS; нет dynamic route labels.

Database connection factory регистрирует уже существующий pool. Scrape читает total,
idle, waiting и одну read-only SQL aggregation outbox. Он не создаёт новый DB login.
Одна Promise на concurrent scrape исключает умножение запросов. SQL имеет local
statement_timeout750ms; connect ограничен pool timeout5s. Snapshot не обещает общий
snapshot со следующим scrape. Gauges queue/age присутствуют для пяти фиксированных
status, включая нули. Age — секунды с outbox event.created_at, не lease expiry.
API/worker читают одну БД: dashboard/alert используют max, не sum двух snapshot.
На DB outage scrape_success=0; это неизвестное состояние, не нулевой backlog.

## Ошибки и ограничения

Raw SQL/driver errors, credentials, payload не возвращаются. Metrics server не имеет
HTTP business/session handlers: GET /metrics возвращает text exposition, остальное404.
Это локальный monitoring endpoint без auth; внешний стенд требует network policy/auth.
При конфликте bind процесс отмечает exitCode1; готовность scrape проверяется отдельно
от business health. Порт0 предназначен для изолированных тестов со случайным портом.
Counters сбрасываются при restart; Prometheus rate/increase учитывают reset. Это не
SLO baseline WMS-403 и не замена PostgreSQL exporter для всех server statistics.

## Пример и тесты

`curl http://127.0.0.1:9464/metrics` при явно включённом listener. JSON logs и UUID
ищутся в Loki, а не в series labels. `test/unit/metrics.spec.ts` использует настоящий
HTTP; `test/integration/metrics.spec.ts` проверяет committed receipt, реальный DB lock
и server timeout, concurrent scrape и работу при отказавшем diagnostic sink.
Полный stack/drill: [observability README](../../../../../infra/observability/README.md).
