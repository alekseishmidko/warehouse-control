# Backend Warehouse Controller

Документация существующего корневого NestJS-модуля и конфигурации backend.
Бизнес-модули пока не реализованы; их границы описаны в [архитектуре](../../docs/architecture.md).

## Для менеджера

Каркас позволяет проверить запуск HTTP и получить имя API. Складские данные
не хранятся, приёмка и отгрузка недоступны. Критерий готовности каркаса:
сервер отвечает на `/` и `/health`. Последний не проверяет БД или складские процессы.
Будущие сценарии — в [описании продукта](../../docs/product.md).

## Для разработчика

AppModule связывает AppController и AppService через Nest DI.
Нет БД, транзакций, миграций, авторизации, событий и consumers.
Стартовые маршруты открыты; это не политика доступа будущих бизнес-endpoints.

| Маршрут | Ответ | Эффект |
|---|---|---|
| GET / | 200, текст Warehouse Controller API | Нет |
| GET /health | 200, JSON со status: ok | Нет |

### Файлы и конфигурация

| Файл | Назначение |
|---|---|
| src/main.ts | Запуск HTTP, shutdown hooks, обработка ошибки старта |
| src/app.module.ts | Корневой composition root |
| src/app.controller.ts | Два технических HTTP-маршрута |
| src/app.service.ts | Статическое имя API |
| package.json | Имя workspace, scripts, runtime/dev dependencies |
| nest-cli.json | sourceRoot: src, очистка dist перед сборкой |
| tsconfig.json | Общий TS, decorators/metadata, src → dist |
| tsconfig.build.json | Исключение тестов и артефактов из build |

PORT — порт HTTP, default 3000, не секрет. Валидации конфигурации пока нет.
Ошибка bind логируется, exit code 1. Логи стандартные Nest/console;
Pino, метрики и tracing запланированы.

Из корня: `pnpm dev`, `pnpm typecheck`, `pnpm build`, затем `pnpm start`.
Для пакета: `pnpm --filter @warehouse/backend <script>`.
Runner тестов ещё не установлен; технические routes проверялись HTTP smoke check.
Повторяющейся вспомогательной логики пока нет; shared вводится по
[правилам](../../docs/shared.md). Будущий [runbook](../../docs/runbooks/event-recovery.md)
не является готовой CLI-инструкцией. См. [ADR](../../docs/adr/README.md)
и [roadmap](../../docs/roadmap.md).
