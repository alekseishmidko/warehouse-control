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
| HTTP_HOST         | IP bind address, dev actor только 127.0.0.1/::1           | 127.0.0.1   | Нет                   |
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
DEV_ACTOR_ENABLED — только true/false, default false. Включение разрешено при
явном NODE_ENV=development/test (default NODE_ENV недостаточен), HTTP_HOST=127.0.0.1/::1
и DEV_ACTOR_ID с UUID. Actor ID задаётся сервером и приводится lowercase; это синтетический
dev/test identifier, не доверие body/headers и не production login. Неверная комбинация
останавливает старт до bind и не выводит значения параметров. Production/public IP
с включённым dev actor запрещены. Без него HTTP_HOST=0.0.0.0 разрешён для будущей
контейнеризации, но business routes останутся закрыты до identity.

Пример в корневом .env.example оставляет actor выключенным. Новые поля RuntimeConfig
переиспользуют DATABASE_CONFIG DI token (экспортируется DatabaseModule) без второго
прочтения process.env в guard. Harness заменяет config на suite-specific объект.
Unit http-foundation.spec.ts проверяет invalid production/default-mode/host/UUID;
HTTP integration проверяет guard повторно даже при вручную повреждённом DI override.
[Правила HTTP](../http/README.md).

## Identity WMS-202

RuntimeConfig больше не содержит devActorId; DEV_ACTOR_ENABLED принимает только false/отсутствие,
true отклоняет startup. Это не переключатель auth в development. Отдельный IdentityConfig
валидирует AUTH_ORIGIN и обязательные absolute/idle seconds; в worker/seed graph эти
HTTP-настройки не требуются. API/bootstrap требуют явных значений без defaults; подробнее
[identity](../../../../../docs/identity.md) и module README. .env не перезаписывается автоматически.
