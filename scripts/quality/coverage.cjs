/** @file Coverage ratchet: сравнивает все собственные файлы с принятой исходной точкой, не скрывает новые/пропавшие записи. */
const fs = require('node:fs');
const path = require('node:path');
const metrics = ['lines', 'statements', 'functions', 'branches'];
/** Сравнивает относительные source paths; baseline нельзя автоматически перезаписывать при отказе. */
function compareCoverage(current, baseline) {
  const errors = [];
  // Отсутствующие/NaN метрики нельзя считать успешным сравнением: JS comparison иначе вернёт false.
  if (!baseline || !current || !Object.keys(baseline).length)
    return ['Coverage baseline/current is empty or invalid'];
  for (const [label, entries] of [
    ['baseline', baseline],
    ['current', current],
  ]) {
    for (const [file, values] of Object.entries(entries)) {
      if (!file.startsWith('src/')) errors.push(`${label}: unexpected source path ${file}`);
      for (const metric of metrics)
        if (!Number.isFinite(values?.[metric]) || values[metric] < 0 || values[metric] > 100)
          errors.push(`${label}: invalid ${metric} for ${file}`);
    }
  }
  if (errors.length) return errors;
  for (const [file, values] of Object.entries(baseline)) {
    if (!current[file]) {
      errors.push(`Missing covered source: ${file}`);
      continue;
    }
    for (const metric of metrics)
      if (current[file][metric] < values[metric])
        errors.push(`${file}: ${metric} ${current[file][metric]} < ${values[metric]}`);
  }
  for (const file of Object.keys(current))
    if (!baseline[file]) errors.push(`New source needs tests and reviewed baseline: ${file}`);
  return errors;
}
/** Удаляет машинозависимые абсолютные prefixes, оставляет все четыре метрики каждого source файла. */
function normalizeSummary(summary, backend) {
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([file]) => file !== 'total')
      .map(([file, data]) => [
        path.relative(backend, file).split(path.sep).join('/'),
        Object.fromEntries(metrics.map((metric) => [metric, data[metric].pct])),
      ]),
  );
}
module.exports = { compareCoverage, normalizeSummary };
if (require.main === module) {
  const root = path.resolve(__dirname, '../..'),
    backend = path.join(root, 'apps/backend');
  const current = normalizeSummary(
    JSON.parse(
      fs.readFileSync(path.join(backend, 'coverage/backend/coverage-summary.json'), 'utf8'),
    ),
    backend,
  );
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, 'docs/coverage-baseline.json'), 'utf8'),
  );
  const errors = compareCoverage(current, baseline);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(`Coverage baseline: ${Object.keys(current).length} source files, no regressions`);
}
