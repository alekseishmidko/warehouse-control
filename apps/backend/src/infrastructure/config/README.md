# Конфигурация процесса

Документация `environment.ts`: единый контракт окружения для HTTP, Drizzle Kit и CLI.

## Для менеджера

Некорректные настройки останавливают запуск до открытия HTTP.
Сообщения не показывают пароли. Этот компонент не выполняет складских операций.

## Для разработчика

`loadEnvironment()` читает optional `.env` в корне репозитория независимо от cwd;
переменные процесса имеют приоритет. В production файл не обязателен.
При переносе runtime-кода в другой layout нужно сохранить путь конфигурации или
пересмотреть loader. `validateEnvironment(env)` — чистая функция, не подключается к БД.
Результат RuntimeConfig immutable, databaseUrl чувствителен и не логируется.

| Параметр          | Правило                                                   | Default     | Секрет                |
| ----------------- | --------------------------------------------------------- | ----------- | --------------------- |
| NODE_ENV          | development, test или production                          | development | Нет                   |
| PORT              | Целое десятичное число 1–65535                            | 3000        | Нет                   |
| HTTP_HOST         | IP bind address для API                                   | 127.0.0.1   | Нет                   |
| DEV_ACTOR_ENABLED | true/false; включение только explicit development/test    | false       | Нет                   |
| DEV_ACTOR_ID      | Server UUID, обязателен только при enabled=true           | Нет         | Нет, синтетический ID |
| DATABASE_URL      | postgres/postgresql URL с пользователем, host и именем БД | Обязателен  | Да                    |

Проверка URL синтаксическая; доступность, SSL, права и наличие БД проверяет
подключение, а не parser. Пароль в URL не обязателен: способ аутентификации
зависит от сервера. Настройки TLS внешнего стенда потребуют отдельной задачи.
Пустая переменная не считается отсутствующей. PORT=0 не поддерживается.
Ошибки содержат имя параметра, но не полученное значение.

Команды: из корня `pnpm test:config`, `pnpm typecheck`, `pnpm build`.
Тесты находятся в `apps/backend/test/unit/environment.spec.ts`, используют Jest,
не требуют Docker и проверяют реальный entrypoint с invalid URL.
Integration harness переопределяет validated config через DATABASE_CONFIG provider
без изменения process.env. Бизнес-транзакций и событий здесь нет.

## HTTP isolation WMS-107

HTTP_HOST — IP bind address, default 127.0.0.1; main передаёт его в listen.
DEV_ACTOR_ENABLED допускает false/отсутствие, true отклоняет startup во всех режимах.
Dev actor удалён; DEV_ACTOR_ID не создаёт identity. HTTP_HOST=0.0.0.0 применяется в Docker,
но business routes всегда требуют session/warehouse policy. RuntimeConfig переиспользует
DATABASE_CONFIG, harness заменяет config через DI без process.env mutations.
[HTTP policy](../http/README.md), [identity flow](../../../../../docs/flows/identity.md).

## Identity WMS-202

RuntimeConfig больше не содержит devActorId; DEV_ACTOR_ENABLED принимает только false/отсутствие,
true отклоняет startup. Это не переключатель auth в development. Отдельный IdentityConfig
валидирует AUTH_ORIGIN и обязательные absolute/idle seconds; в worker/seed graph эти
HTTP-настройки не требуются. API/bootstrap требуют явных значений без defaults; подробнее
[identity](../../../../../docs/identity.md) и module README. .env не перезаписывается автоматически.
