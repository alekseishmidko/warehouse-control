# Test support

Переиспользуемая тестовая инфраструктура WMS-102, не runtime-модуль приложения.
Для менеджера: каждый набор проверок получает собственную временную БД и не меняет
рабочие данные. Для разработчика: вся логика ресурсов и fixtures собрана здесь.

- database-harness.ts: PostgreSQL image из Compose, отдельный container/database,
  реальные migrations, config override настоящего AppModule, reset и LIFO cleanup.
- audit.fixture.ts: валидные синтетические audit IDs/коды и overrides для негативных tests.
- metadata.fixture.ts: уникальные технические записи, без бизнес-правил.

Публичные функции: createDatabaseHarness, withDatabaseHarness, useDatabaseSuite,
metadataFixture, auditFixture. Harness предоставляет connection, validated config, containerId,
closed, createHttpApplication/reset/dispose. dispose идемпотентен; closed=true
только после успешного cleanup всех ресурсов. Ошибка setup/cleanup не пропускается.
Config содержит случайный тестовый пароль и не предназначен для логирования.

Без фоновых jobs, бизнес-транзакционных портов и событий; их тестирование появится
с реализацией соответствующих модулей. Ограничения, timeouts, команды и примеры
жизненного цикла описаны в [общем README](../README.md), проверки — integration/*.spec.ts.
Изменения support проверять на всех всех integration suites.

WMS-103: reset audit/movements выполняется владельцем disposable БД с временным отключением
обоих triggers в одной транзакции. Runtime не имеет этой возможности; production cleanup
журнала не реализован. Очистка после неуспешного test не ослабляет persisted DB grants.


WMS-108: database-lock.ts экспортирует waitForDatabaseLock(harness, relation),
параметризованно наблюдает pg_stat_activity/pg_blocking_pids, deadline 5 секунд;
helper не реализует бизнес-логику и не заменяет PostgreSQL mocks. Его используют
receiving.spec.ts, http-commands.spec.ts и worker.spec.ts. Receiving reset отключает только retained
triggers в disposable admin transaction; штатные constraints/guards остаются активны.


WMS-109: createWorkerApplication(handlers,config) создаёт отдельный настоящий WorkerModule
без HTTP и регистрирует закрытие graph/pool в harness cleanup. Config providers заменяются
DI, process.env parent не меняется. Reset выключает processed_events_immutable и
consumer_streams_retained только на время disposable admin TRUNCATE; journal сохраняется.
worker-process.fixture.ts загружает production dist без Jest mapper, использует только
технический metadata effect и IPC barriers/commit notification для process failure tests.
IPC ожидание внутри handler допустимо здесь только как явно тестовая fault injection.


WMS-110: createWorkerApplication() теперь сохраняет production ReceivingPostedHandler;
явный handlers=[] отключает registry, список handlers заменяет его для protocol tests.
posted-receipt.fixture.ts создаёт production fixture/draft/post в общем контексте, не копирует
бизнес-правила и не пишет stock/task напрямую. putaway_tasks_immutable отключается только
при disposable admin cleanup; business audit/marker/task constraints остаются активны в tests.
Child fixture имеет isolated TEST_PUTAWAY_HANDLER mode с реальными task/audit эффектами
и IPC barrier до commit; затем отправляет notification только после production commit.
