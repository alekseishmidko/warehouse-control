# Vendor patch deepmerge 4.3.1

GHSA-gcqx-w48m-w2h4/CVE-2026-93753 не имеет исправленного upstream-релиза на 2026-11-09.
`deepmerge@4.3.1.patch` создан `pnpm patch`/`pnpm patch-commit`; pnpm фиксирует hash
в lockfile и применяет его при install, включая frozen Docker builds.

Патч отбрасывает `__proto__`, `constructor`, `prototype` в общем перечислении ключей
source И target. Проверки только прототипа target недостаточно для null-prototype
и own `__proto__` объекта. Остальные ключи/символы, default concat массивов и .all
сохраняются. Исправлены upstream index.js и опубликованные CJS/UMD entrypoints.
Это vendor artifact patch, а не ручная правка generated schemas или applied SQL.

`pnpm test:dependencies` загружает package через настоящие Jest/CLI dependency paths,
воспроизводит poisoning и проверяет prototypes результата; до patch тест падает.
Остальные проверки проверяют glob API archiver и CORS esbuild через Drizzle loader.

`pnpm audit` по-прежнему сообщает 1 low по номеру deepmerge 4.3.1: advisory registry
не знает содержимое локального patch. Этот сигнал не подавляется; audit exit1
сохраняется в отчёте. `pnpm audit --prod` не должен иметь advisory. Изменённый код
исправлен, но нельзя объявлять full registry audit «0 vulnerabilities».

При выходе upstream fix удалить patch только после повторения poisoning regression,
обновления lockfile штатным pnpm и всех consumer/Docker gates. Нельзя объявлять patch
ненужным только по версии, audit suppression или пропускать его при clean install.
[Источник advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
[upstream PoC](https://github.com/TehShrike/deepmerge/issues/273),
[отчёт](../docs/reports/review-fixes-r04-r06.md).
