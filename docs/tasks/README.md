# Задание harness

Задачу ставит пользователь в чате/issue. Агент переносит запрос в JSON по образцу
harness-runner.json и выводит plan до запуска. Пользователь остаётся владельцем
смысла критериев; уточнение или изменение task меняет content snapshot и требует
нового run. issuedBy — декларация источника запроса, не проверенная identity/signature.

Поля версии1:

- id: стабильный slug задачи; определяет отдельный каталог evidence.
- issuedBy/request: кто дал задание и какой результат запросил. Не помещать secrets.
- base: полный SHA accepted Git commit ДО начала изменений. После commit задачи base
  не следует менять на HEAD ради сокращения diff. Runner сравнивает весь diff от base.
- criteria: непустой список уникальных id, statement, tests и gates.
- tests: source-relative file#test-title. Файл существует, не ignored, не symlink.
  Имя после # — объявленная трассировка, runner не доказывает содержательность теста.
- gates: дополнительные IDs из policy.cjs. Нельзя отключить check:pr или gates diff policy.

JSON не поддерживает комментарии; назначение полей хранится здесь. Task хранится в
Git source, не artifacts. Runner не принимает shell commands из task-файла.
