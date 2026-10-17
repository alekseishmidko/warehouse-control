# Warehouse Controller

Монорепозиторий на pnpm workspaces. Backend на NestJS и TypeScript находится в `apps/backend`.
Новые приложения добавляются в `apps/*`, общие пакеты — в `packages/*`.

## Проектная документация

- [Карта документации и фактический статус](docs/README.md)
- [Архитектура и стек](docs/architecture.md)
- [Домен и инварианты](docs/domain.md)
- [Контракты API и событий](docs/contracts/README.md)
- [Transactional outbox и переход на Kafka](docs/outbox.md)
- [Принятые решения ADR](docs/adr/README.md)
- [Этапы реализации](docs/roadmap.md)
- [Контекст для агента](AGENTS.md)

Сейчас реализован только каркас backend. Документация описывает целевую WMS;
БД, бизнес-модули, Docker и Kubernetes будут добавляться по этапам.

## Запуск

Нужны Node.js 22.12+ и pnpm 10. Версия pnpm закреплена в `package.json`.
Если pnpm ещё не установлен, используйте Corepack:

```sh
corepack enable
pnpm install
pnpm dev
```

`corepack enable` добавляет команду `pnpm`, которая нужна в том числе для корневых скриптов.

API доступен на `http://localhost:3000`:

- `GET /` — приветствие API.
- `GET /health` — `{ "status": "ok" }`.

Порт можно изменить через переменную окружения: `PORT=3001 pnpm dev`.

## Команды из корня

```sh
pnpm dev        # Backend с перезапуском при изменении кода
pnpm typecheck  # Проверка TypeScript во всех пакетах
pnpm build      # Сборка всех пакетов
pnpm start      # Запуск собранного backend (после pnpm build)
```

Команды конкретного приложения: `pnpm --filter @warehouse/backend <команда>`.

Документация: [pnpm workspaces](https://pnpm.io/workspaces), [NestJS](https://docs.nestjs.com/first-steps).
