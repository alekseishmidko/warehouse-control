# Static web origin — WMS-303

Сервер раздаёт только immutable output Vite на 0.0.0.0:8080. Не выполняет proxy,
не читает DB/session credentials и не обрабатывает auth. Gateway направляет /api
непосредственно backend, остальные URL — этому Service.

Ход запроса: разрешить GET/HEAD → декодировать URL → отклонить null/backslash и
путь вне build root → найти файл → для маршрута без расширения вернуть index.html
→ отправить MIME, nosniff и Content-Length → закрыть file stream при disconnect.
Префикс /api никогда не получает SPA fallback; отсутствующие assets и файлы с
расширением возвращают 404. Неизвестный UI route получает index и отображает
«Страница не найдена» в Solid Router. Ошибка URL даёт 400, неизвестный метод —
405 с Allow; отсутствие build index — 503, filesystem paths наружу не выводятся.

Assets output Vite имеют fingerprint names и Cache-Control immutable/year; HTML
не кешируется. На SIGTERM/SIGINT сервер закрывает listener и ждёт соединения.
Root directory — доверенный build output без symlinks, не пользовательский каталог.
Подробные gateway/TLS/security границы: [flow](../../../docs/flows/gateway-tls.md).

Проверка: `pnpm test:web:server`, настоящий HTTP на ephemeral localhost port.
Docker image собирается `docker build -f apps/web/Dockerfile -t warehouse-web:local .`.
`pnpm docker:image-check --web` проверяет чистую сборку, все финальные layers,
read-only/non-root запуск, HTTP readiness и реальный SIGTERM с exit 0.
Runtime содержит только Node, dist и один server CJS, работает UID node и read-only
root filesystem в Helm. Dockerfile использует отдельную build стадию для Vite.
