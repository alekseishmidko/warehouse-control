# Публикация evidence

`writeAtomicJson(path,value)` используется load и recovery drivers. Он создаёт
уникальный файл wx/0600 рядом с accepted report, записывает JSON и выполняет rename.
Ошибка записи или rename оставляет прежний accepted файл; собственный temp удаляется.
Это атомарная замена файла, не гарантия сохранности при потере питания (fsync нет).
`pnpm test:evidence` вводит EIO после частичной записи и отказ rename на настоящем
filesystem и проверяет сохранность старого результата и отсутствие temp.
