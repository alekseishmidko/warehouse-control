# Outbox → Kafka: publisher WMS-503

Владелец: infrastructure/publisher. [Решение](../adr/0034-outbox-kafka-publisher.md).
Publisher не выполняет складской эффект. Он переносит неизменный validated envelope
в Kafka. HTTP actor/ACL остаются у business owner; transport запускает локальный
оператор с runtime DB login и mTLS Kafka principal.

```mermaid
sequenceDiagram
    participant B as API / business owner
    participant PG as PostgreSQL
    participant P as Singleton publisher
    participant K as Kafka broker
    participant C as Future consumer (WMS-504)
    B->>PG: stock + audit + envelope + local delivery (one commit)
    Note over B,K: Kafka недоступна — бизнес commit всё равно возможен
    P->>PG: dedicated session advisory lock + retained history check
    P->>K: TLS, topology check, stable transactionalId
    loop Один event за раз
        P->>PG: BEGIN; findNextEvent(cursor+1); persistAttempt; COMMIT
        PG-->>P: persisted envelope и identity
        P->>P: validateRecord: schema + SQL identity
        P->>K: begin transaction; send(key, fixed partition, acks=all)
        P->>K: commit transaction
        K-->>P: broker commit ack
        P->>PG: BEGIN; token check; completed + cursor; COMMIT
        Note over PG,K: Crash в этом промежутке → повтор eventId, возможен duplicate
    end
    K-->>C: read_committed records; dedup/effect — отдельный WMS-504
```

## Шаги и ветки отказа

1. Оператор проверяет версии/схемы и создаёт topics/ACL отдельно от приложения.
   Source topic mapping: `docs/contracts/kafka-topology.json`; generated TS и AsyncAPI
   обновляются командами `pnpm contracts:generate`, `pnpm asyncapi:generate`.
2. Startup валидирует opt-in, broker host:port, stable ID, TLS files и timeout bounds.
   URLs/PEM/driver errors не попадают в logs. Отсутствие истории или второго owner
   останавливает startup до отправки. Database owner connection не переподключается.
3. Claim выбирает только `last_completed_version+1`. Регистрация kafka.publish не
   меняет прежнюю inventory.putaway subscription. У каждого aggregate свой cursor.
   Dead блокирует собственный stream, другие aggregates доступны. События всех4типов
   публикуются; consumer responsibilities пока есть только у inventory.putaway.
4. Service проверяет envelope локальным EventContracts и сравнивает eventId/type/id/version
   с immutable SQL columns. Некорректный envelope становится dead, отправки нет.
5. Transport вычисляет topic/key/partition и отправляет JSON envelope без добавления
   нового eventId/версии. Headers: content-type, x-event-type, x-schema-version.
   traceparent/correlationId сохраняются в envelope. Payload не печатается.
6. После broker transaction commit ack repository атомарно завершает delivery и
   продвигает cursor. Несовпадение token/cursor откатывает completion; success log
   появляется только после SQL commit. Consumer marker transport не создаёт.
7. При network/ack ошибке delivery получает retry, cursor остаётся прежним, процесс
   завершается с ошибкой. Минимальная SQL eligibility задержка retry1s, максимум10попыток; фактический интервал
   зависит от рестарта процесса/Pod backoff; последняя ошибка → dead.
   Failed process нельзя переиспользовать с прежним producer state. Pod restart создаёт
   новый epoch. Crash до fail оставляет processing; новый singleton восстанавливает
   attempt сразу, не ждёт lease, потому что exclusive owner уже доказан session lock.
8. SIGTERM запрещает следующий tick и даёт текущей операции закончиться; process
   deadline45s включает disconnect/SQL cleanup. Через60s Kubernetes может SIGKILL.
   Startup проверяет Kafka; readiness затем проверяет DB owner, liveness — только
   состояние процесса. Idle readiness не является непрерывной проверкой broker.

## Dev запуск и release

Сначала [Kafka](../../infra/kafka/README.md) и [Registry](schema-release.md).
Проверить runtime migrations включая0033,4topics/3partitions, TLS/ACL и полную
retained history. Working `.env` менять не требуется. Пример shell использует только
пути к локальным Secret files и env, не значения ключей:

```sh
pnpm build
pnpm registry:check
PUBLISHER_ENABLED=true PUBLISHER_REPLAY=from-start \
PUBLISHER_BROKERS='<reachable-bootstrap-host>:9093' \
PUBLISHER_TRANSACTIONAL_ID=warehouse-outbox-publisher \
PUBLISHER_CA_FILE=/secure/ca.crt PUBLISHER_CERT_FILE=/secure/user.crt \
PUBLISHER_KEY_FILE=/secure/user.key pnpm publisher
```

| Переменная                               | Default / проверка                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PUBLISHER_ENABLED                        | Обязательно `true`; по умолчанию процесс не включён.                                                                    |
| PUBLISHER_REPLAY                         | Обязательно `from-start`; иной boundary не поддерживается.                                                              |
| PUBLISHER_BROKERS                        | Обязательный список DNS/IPv4 host:port через запятую, port1..65535; не URL с credentials.                               |
| PUBLISHER_TRANSACTIONAL_ID               | Обязательное стабильное имя3..96символов; literal Kafka ACL должен совпасть.                                            |
| PUBLISHER_CA_FILE / CERT_FILE / KEY_FILE | Обязательные readable PEM files; TLS key/cert проверяются до DB connect.                                                |
| PUBLISHER_REQUEST_TIMEOUT_MS             | 5000ms; допустимо500..10000.                                                                                            |
| PUBLISHER_POLL_MS                        | 1000ms; допустимо10..60000, применяется только к idle.                                                                  |
| PUBLISHER_SHUTDOWN_MS                    | 45000ms; допустимо35000..120000. Grace Pod должен превышать выбранное значение; chart использует default45s и grace60s. |
| PUBLISHER_HEALTH_PORT                    | 9101; допустимо1..65535, только GET probes.                                                                             |

Node24.19.0 на macOS имеет известный bundled undici `setTypeOfService EINVAL` при
fetch к закрываемому HTTP listener. Для проверок использован Node24.22.3 с undici7.30.2;
глобальный runtime машины не менялся. Это ограничение host tooling, не повод подавлять
ошибки приложения или ослаблять lifecycle tests. [Upstream fix](https://github.com/nodejs/undici/pull/5547).

Внутренний Strimzi listener рекламирует cluster DNS, одного port-forward bootstrap
недостаточно. В kind запускать publisher в Pod того же cluster через optional chart
`publisher.enabled=true`; secrets должны существовать в application namespace.
Не публиковать private key через --set, manifests, shell stdout или Git. Operator
копирует CA ca.crt и client user.crt/user.key в Secrets безопасным local provisioning.

Chart использует тот же backend image digest; `publisher.replay=from-start`, один
stable transactionalId, replicas1/Recreate. Release preflight `registry:check` обязателен
ДО helm upgrade. Migration hook расширяет CHECK без изменения writer/старых consumers.
Publisher не имеет публичного Service/Gateway; health listener9101 доступен внутри Pod.

## Безопасные причины отказа конфигурации

При startup `PublisherConfigurationError` передаёт только code из shared/logging.
Например, введённый вместо broker URL с password не отражается в JSON logs.
Неизвестное исключение раннего startup получает PUBLISHER_STARTUP_FAILED; runtime
SQL/network failure по-прежнему не раскрывает текст драйвера.

| errorCode                          | Что проверить                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| PUBLISHER_OPT_IN_REQUIRED          | ENABLED=true и REPLAY=from-start.                                              |
| PUBLISHER_BROKERS_INVALID          | Формат host:port, диапазон port, отсутствие credentials в адресе.              |
| PUBLISHER_TRANSACTIONAL_ID_INVALID | Стабильный ID и допустимые символы/длина.                                      |
| PUBLISHER_TLS_INVALID              | Доступность CA/cert/key, PEM и соответствие key/cert; paths не пишутся в logs. |
| PUBLISHER_REQUEST_TIMEOUT_INVALID  | REQUEST_TIMEOUT_MS500..10000.                                                  |
| PUBLISHER_POLL_INVALID             | POLL_MS10..60000.                                                              |
| PUBLISHER_SHUTDOWN_INVALID         | SHUTDOWN_MS35000..120000 и соответствующий Pod grace.                          |
| PUBLISHER_HEALTH_PORT_INVALID      | HEALTH_PORT1..65535.                                                           |

`delivery.retry` сохраняет KAFKA_UNCONFIRMED в JSON errorCode. Это неизвестный исход
broker операции, не доказательство отсутствия Kafka record: повтор сохраняет eventId.
Allowlist не принимает произвольные значения даже с префиксом PUBLISHER_.

## Диагностика и ручное восстановление

```sh
kubectl -n <app-ns> get pods -l app.kubernetes.io/component=publisher
kubectl -n <app-ns> logs deployment/<release>-publisher --tail=100
```

Искать JSON поля eventId, aggregateId, destination=kafka.publish, attempt/errorCode.
SQL только для чтения (не печатать envelope с бизнес-данными):

```sql
select event_id,status,attempts,last_error,available_at
from outbox_deliveries where destination='kafka.publish' order by available_at;
select aggregate_type,aggregate_id,last_completed_version
from delivery_streams where destination='kafka.publish';
select pid,granted from pg_locks
where locktype='advisory' and classid=1464685363 and objid=503;
```

1. Остановить Deployment/host процесс. При node partition подтвердить физическое
   завершение старого процесса на узле; отсутствие Pod в API этого не доказывает.
2. Проверить DB session owner и broker connectivity/ACL/TLS. Не менять ID/partition
   count и не выполнять pg_advisory_unlock из чужой session: это не безопасный fencing.
3. Восстановить Kafka/credentials/config, затем запустить один owner. TLS PEM читаются
   один раз при startup: после ротации Secret нужен restart/Recreate, одного обновления
   projected files недостаточно. Stable transactionalId сохраняется. Retry использует
   тот же eventId и прежний cursor; проверить completed и последовательность records.
4. Dead не сбрасывать SQL вручную. Текущий recovery CLI ориентирован на local consumer;
   retry/quarantine transport будет расширен в WMS-505. До него остановить publisher,
   сохранить evidence и устранить причину в отдельном reviewed recovery изменении.

Не удалять outbox, delivery rows, sequence или PVC ради устранения ошибки. Old local
worker продолжает работать; он не является Kafka consumer. Cutover/перенос незавершённых
local deliveries и HA publisher не входят в503. Single broker RF1/ISR1 не является HA.

## Evidence

[Отчёт и соответствие AC](../reports/wms-503.md); реальные PostgreSQL/Kafka проверки
в `apps/backend/test/integration/publisher.spec.ts`. Отдельно проверяются uncertain
ack, SIGKILL barrier, producer epoch, root entrypoint и shutdown. Child test coverage
не приписывается parent coverage.
