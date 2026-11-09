# Завершение процесса и probes

## Бизнес-результат

Обновление приложения не отменяет подтверждённую складскую операцию. При потере
ответа клиент использует прежний key. Незавершённая transaction откатывается;
worker восстанавливает оставленный claim по lease. Shutdown не создаёт новую попытку.

## Техническое устройство

ProcessHealth разделяет startup/live/ready. API публикует маршруты через AppController,
worker — отдельный native HTTP listener на9100 без Service/Gateway и складских routes.
GET /health сохранён как совместимый liveness. Readiness выполняет SELECT1 через
DatabaseService; ошибки не раскрываются. Сам probe не проверяет schema/grants каждого
бизнес-сценария. API bootstrap остаётся зависим от первоначальной доступности БД.

runApiProcess владеет signals/listener/drain/pool cleanup. Middleware отклоняет новые
запросы при drain; server.close ждёт active responses до app.close. Общий API deadline20s
включает startup и cleanup; default DB transaction/statement timeout10s задаёт runner.
Identity и worker устанавливают свои бюджеты. Worker stop прекращает следующий claim;
активный batch завершается через Promise.allSettled. Его deadline15s больше transaction10s.
Kubernetes grace30s превышает оба drain бюджета. SIGKILL не исполняет finally приложения.

Подробный flow, исключения и эксплуатация: [lifecycle](../../../../../docs/flows/lifecycle.md).
Проверки: process-health unit; lifecycle integration/child process; worker/worker-process;
`pnpm lifecycle:gate` для настоящих Pod, Gateway и release migration.

API preStop в Kubernetes ждёт5s после начала Pod termination для распространения
EndpointSlice/Gateway. Бюджет5s + API deadline20s укладывается в grace30s;
при прямом Docker SIGTERM preStop отсутствует, process deadline остаётся20s.
