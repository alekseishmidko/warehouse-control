# 0020. Реализация сессий, CSRF и синхронной авторизации

- Дата: 2026-10-29
- Статус: Accepted как техническая реализация ADR-0018/0019; числовые TTL не утверждает.

## Контекст и решение

Выбранные пользователем server sessions и warehouse роли требуют общего PostgreSQL
состояния, отзыва и повторной проверки до saved HTTP replay. Внешний IdP/Redis/JWT
не добавляются. Реализация находится в обычном Nest identity controller/service/repository.

Credentials: Node crypto.scrypt N=2^17/r=8/p=1 (OWASP-вариант при отсутствии Argon2id),
salt 16 bytes, key 64 bytes, fixed parser, max 2 in-flight hashing operations на процесс.
Пароль не нормализуется; 15..128 символов и <=512 UTF-8 bytes. Hashing выполняется вне
DB transaction, после чего login перечитывает user/password hash под lock. В БД случайный
256-bit session token хранится только как SHA-256 digest. Это не заменяет password hashing.

Browser cookie: HTTPS __Host-wms_session, HttpOnly/Secure/SameSite=Strict/Path=/ без Domain;
явный dev/test loopback HTTP использует wms_session без Secure. AUTH_ORIGIN точный,
production origin только HTTPS. Приложение не завершает TLS само: внешний доступ требует
TLS gateway, до него backend не выставляется в недоверенную сеть.

CSRF: unsafe запросы требуют exact Origin + application/json. Login без сессии требует
X-CSRF-Protection:1 (custom header, CORS выключен). Сессионные команды требуют X-CSRF-Token,
HMAC связанный с cookie token, из login/me same-origin JSON. Токен не выводится в логах,
ответы no-store. SameSite — дополнение, не единственная защита. Password/session controllers
не используют HTTP result cache: SHA-256 fingerprint plaintext password ослабил бы дорогой hash.

ACL: guard создаёт principal, а service повторно проверяет user/session/warehouse action
в context складской команды **до** idempotency claim/replay. SHARE locks user/session удерживаются
до commit; admin меняет target user под UPDATE, блокируя новые решения до фиксации.
В собственной административной операции user UPDATE берётся до проверки сессии,
см. уточнение блокировок ниже. Logout использует user SHARE → session UPDATE.
Уже начатая разрешённая транзакция может завершиться перед отзывом; отмены committed
фактов нет. Бюджет/clock для expiry — PostgreSQL, idle refresh <= absolute deadline.

Без утверждённых чисел нет defaults: AUTH_SESSION_ABSOLUTE_SECONDS и
AUTH_SESSION_IDLE_SECONDS обязательны явно, 30..86400, idle<=absolute. Test fixtures
используют собственные короткие значения; это не принятие предложенных 12h/30m.
Bootstrap — отдельный stdin CLI, explicit opt-in, loopback DB либо dev/test Docker host
postgres, DB group warehouse_identity_bootstrap и retained one-time marker. HTTP bootstrap/
registration отсутствуют. Admin mutations аудитируются одним commit; последний active
system_admin защищён общей advisory lock. В production graph нет dev actor или fallback.

## Альтернативы и ограничения

Argon2id потребовал бы нового native dependency/experimental API Node; выбран стабильный
scrypt. Cookie-only/SameSite-only не покрывает CSRF. Session snapshot с навсегда сохранёнными
ролями не покрывает revoke. Проверка только в business callback пропускает replay и не выбрана.
Дополнительный HTTP permission framework здесь не требуется: действия перечислены явно.

Ограничение попыток login/IP — общие DB windows, не полноценная DDoS-защита. IP берётся
из socket, forwarded headers не считаются доверенными; перед внешним proxy нужны настройка
и проверка real-client/rate policy. MFA/SSO/recovery UI не реализованы.

## Проверка

[Полный flow](../flows/identity.md), [module README](../../apps/backend/src/modules/identity/README.md),
[отчёт WMS-202](../reports/wms-202.md). Настоящие PostgreSQL tests проверяют expiry/revoke,
warehouse scope/replay, admin race, audit/session faults и compiled bootstrap; Docker gate
использует реальные login/grants вместо test-only actor. Числа финального прогона — в отчёте.
Источники: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Уточнение реализации: отдельные сервисы внутри IdentityModule

2026-10-29 пользователь утвердил разделение AuthService, SessionsService, UsersService и
AccessService. Сохраняются один IdentityModule, внутренний IdentityRepository и прежние
транзакционные гарантии. IdentityTransactionsService переиспользует ограниченный runner;
вложенного run в create/revoke/requireSession/requireAdmin/requireWarehouse нет. Старый
IdentityService удалён, клиенты обращаются к сервису своей ответственности. Это локальная
декомпозиция по ADR-0009, без новых таблиц, cookie/API изменений или отдельных процессов.
[Фактический flow и failure branch](../flows/identity.md#разделение-сервисов-общий-context-при-смене-пароля).

## Уточнение блокировок собственных операций, 2026-10-31

Review воспроизвёл deadlock при изменении собственного пользователя или отзыве собственной
сессии параллельно с authenticate. Общая административная блокировка не сериализует
аутентификацию. В собственной операции UsersService теперь получает user UPDATE до
session SHARE и повторной проверки допуска. UUID сравниваются без учёта регистра.
Для чужого пользователя порядок caller user/session → target user сохраняется.

Это уточнение исполнения принятой policy, без изменения ролей, HTTP-контрактов или DDL.
Проверка валидности и продление сессии разделены на `lockSessionAndReadValidity` и
`refreshSessionIdleDeadline` с одним context. Параметры SessionsService именованы:
`sessionLock` и `refreshIdleSeconds`. [Флоу и постоянные тесты](../flows/identity.md#собственные-административные-операции).
