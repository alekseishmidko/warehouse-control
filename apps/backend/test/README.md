# Тестовая инфраструктура backend

WMS-102: Jest unit/integration projects, Supertest и PostgreSQL Testcontainers.
Для менеджера: проверки подтверждают изоляцию данных, commit/rollback, работу
технического HTTP и освобождение ресурсов при ошибке. Складские сценарии ещё не реализованы.

## Команды из корня

```sh
pnpm test:unit        # без Docker: runtime configuration и startup failure
pnpm test:integration # реальные временные PostgreSQL containers, нужен Docker
pnpm test            # оба проекта, максимум два Jest workers
pnpm test:config     # совместимый alias test:unit
pnpm typecheck       # production source и TypeScript tests
```

Команды test/test:unit/test:integration выполняют test:prepare: собирают backend,
удаляют старый .test-dist и компилируют tests через tsconfig.test.json.
Jest читает compiled tests; @backend/* отображается в настоящий production dist,
поэтому тесты не исполняют вторую копию приложения из test output.
Без --passWithNoTests и --forceExit: пустая suite или незакрытые ресурсы не скрываются.
Не запускать одновременно несколько test:prepare в одном checkout: они очищают output.
Параллельность поддерживается между suites внутри одного Jest-прогона.

## Файлы

| Файл / каталог | Назначение |
|---|---|
| ../jest.config.cjs | Два projects с отдельными testMatch, maxWorkers=2, Node environment |
| ../tsconfig.test.json | TS aliases/types и compiled output .test-dist; source/tests typecheck |
| integration.setup.cjs | 120 секунд для integration tests/hooks |
| unit/environment.spec.ts | Строгая конфигурация и redaction, без БД |
| integration/database.spec.ts | Реальные SQL migrations, commit/rollback и очистка |
| integration/http.spec.ts | Настоящий AppModule и Supertest, закрытие app pool |
| integration/lifecycle.spec.ts | Cleanup после assertion failure и две независимые БД с одинаковыми ключами |
| support/database-harness.ts | Жизненный цикл БД/приложения, migrations и cleanup |
| support/metadata.fixture.ts | Уникальная техническая metadata-запись без бизнес-логики |
| database-baseline.test.cjs | Сохранённая native WMS-101 проверка Compose restart, вне Jest testMatch |

## Docker prerequisites

Нужны работающий Docker-compatible daemon, доступ к его socket и registry для
первой загрузки PostgreSQL и Ryuk. Docker Desktop arm64 проверен локально.
Compose запускать **не нужно**: harness не использует .env, dev DATABASE_URL,
фиксированный host port или dev volume. Он читает только PostgreSQL image из
infra/compose/compose.yaml, поэтому major/patch/digest совпадают с dev-стендом.
Собственные переменные DOCKER_HOST/TLS и socket override настраиваются по
[официальной инструкции runtime](https://node.testcontainers.org/supported-container-runtimes/).
Не отключать Ryuk ради обхода ошибок без отдельного плана уборки ресурсов.

## Изоляция и lifecycle

Отдельный container и случайное имя БД на suite. Порты динамические, credentials
случайные. Миграции применяются Drizzle migrator из backend/drizzle, ORM auto-sync нет.
После каждого теста очищается только application_metadata, journal не трогается.
При добавлении таблиц обновлять reset с учётом FK; не запускать test.concurrent
на одном harness. Для concurrent сценария создавать собственные harnesses.
Данные другого suite или dev Compose не очищаются.

Startup PostgreSQL ограничен 60 секундами, suite hook/test — 120 секундами.
Cleanup каждого ресурса ограничен 15 секундами, container stop — 10 секундами,
afterAll — 60 секундами. Сначала закрываются HTTP/Nest, затем pool, затем container.
Ошибки cleanup приводят к провалу; timeout не считается доказательством освобождения.
Если runner аварийно убит, Ryuk — дополнительная страховка, не замена finally.
Холодная загрузка images зависит от registry и сети; при timeout диагностировать
причину, не увеличивать лимит бесконтрольно и не добавлять skip.

## Fixtures и новые suites

Общий test-only код находится в support, не в production shared.
Fixture создаёт уникальные технические значения; не повторяет доменные правила.
Для обычной suite вызвать useDatabaseSuite на верхнем уровне, получить harness
в тесте, использовать production db/application interfaces. Для проверки отказов
использовать withDatabaseHarness: finally освобождает ресурсы после callback throw.
Config Nest заменяется через DATABASE_CONFIG provider, process.env не изменяется.
Регистрацию app cleanup выполняем до app.init, чтобы ошибка init также убиралась.

## Если Docker недоступен

Integration setup бросает явную ошибку; Jest выходит с ненулевым кодом.
Нет fallback на localhost, in-memory mock или успешный skip. Unit tests остаются
доступны отдельно. Проверено также при запрете доступа к Docker socket.

Диагностика: docker version/info, Docker context, registry/network и доступ к socket.
При необходимости DEBUG=testcontainers* использовать локально и проверять вывод
перед публикацией: подробные логи могут содержать настройки окружения.
Остатки контейнеров проверять только по label warehouse-controller.test=integration;
не применять Docker-wide prune и не удалять чужие контейнеры.

## Отдельная проверка WMS-101

pnpm test:db-baseline требует **dev Compose**, перезапускает postgres проекта,
не входит в pnpm test и не предназначена для параллельного запуска с API.
См. [Compose](../../../infra/compose/README.md). Не путать её с изолированными integration suites.
