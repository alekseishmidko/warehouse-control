/** @file Генерация TS и runtime schemas из docs/contracts/events; --check запрещает устаревшие artifacts без записи. */
const { readFile, readdir, mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { compile } = require('json-schema-to-typescript');

// Пути считаются от script, поэтому генерация не зависит от cwd запускающего процесса.
const sourceDirectory = resolve(__dirname, '../../../docs/contracts/events');
const defaultOutputDirectory = resolve(__dirname, '../src/shared/events/generated');
const banner =
  '/** @file GENERATED из docs/contracts/events: pnpm contracts:generate. Не редактировать вручную. */';

/**
 * Создаёт TS types и runtime schema bundle из одних исходных JSON Schema.
 *
 * @param {{ check?: boolean, outputDirectory?: string }} options
 * check запрещает запись и обнаруживает missing/stale output; outputDirectory
 * позволяет тестам проверять generation diff вне рабочего дерева проекта.
 * @returns {Promise<void>} Завершение генерации либо успешного сравнения.
 * @throws Ошибки чтения/разбора schemas, генератора, I/O и несовпадения artifacts.
 *
 * В artifacts нет timestamps и абсолютных путей: одинаковые исходники и lockfile
 * должны давать побайтово одинаковый результат на повторном запуске.
 */
async function generateEventContracts({
  check = false,
  outputDirectory = defaultOutputDirectory,
} = {}) {
  // readdir не гарантирует порядок; сортировка стабилизирует порядок схем и declarations.
  const files = (await readdir(sourceDirectory))
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  const schemas = {};
  const declarations = [];
  for (const file of files) {
    const schema = JSON.parse(await readFile(resolve(sourceDirectory, file), 'utf8'));
    // Filename без суффикса — стабильный ключ runtime bundle; title — имя generated TS type.
    schemas[file.replace('.schema.json', '')] = schema;
    declarations.push(
      await compile(schema, schema.title, {
        // Один общий banner добавляем ниже, чтобы не повторять его перед каждым типом.
        bannerComment: '',
        format: true,
        // Не разворачиваем maxItems=1000 в огромный union tuple-типов.
        // Runtime продолжает проверять максимум; minItems может быть выражен tuple-префиксом.
        maxItems: 0,
        style: { singleQuote: true, semi: true, tabWidth: 2 },
      }),
    );
  }
  // Bundle содержит схемы прямо в TS: собранному backend не нужно читать docs на диске.
  // Оба файла являются generated artifacts; ручные правки обнаружит --check.
  const outputs = {
    'event-types.ts': `${banner}\n${declarations.join('\n')}`,
    'event-schemas.ts': `${banner}\nexport const eventSchemas = ${JSON.stringify(schemas, null, 2)} as const;\n`,
  };
  // Даже каталог не создаётся в режиме check: команда не должна менять checkout.
  if (!check) await mkdir(outputDirectory, { recursive: true });
  for (const [name, contents] of Object.entries(outputs)) {
    const path = resolve(outputDirectory, name);
    if (check) {
      const actual = await readFile(path, 'utf8').catch((error) => {
        // Отсутствующий artifact — ожидаемый generation diff, прочие I/O ошибки сохраняем.
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (actual !== contents)
        throw new Error(`Generated event contracts differ: ${name}. Run pnpm contracts:generate`);
    } else {
      await writeFile(path, contents);
    }
  }
}

// Export используется тестом в отдельном Node process; CLI запускается только напрямую.
module.exports = { generateEventContracts };
if (require.main === module) {
  const arguments_ = process.argv.slice(2);
  // Не игнорируем опечатки: ошибочный флаг не должен случайно запустить запись artifacts.
  if (arguments_.some((argument) => argument !== '--check')) {
    console.error('Usage: generate-event-contracts.cjs [--check]');
    process.exitCode = 1;
  } else {
    generateEventContracts({ check: arguments_.includes('--check') }).catch((error) => {
      // Ненулевой код позволяет test:prepare и будущему CI остановиться на drift/error.
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
