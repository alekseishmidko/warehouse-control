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
