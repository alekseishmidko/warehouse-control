/** @file Offline OpenAPI generation из production graph без lifecycle init/DB; --check не меняет artifact. Требует build. */
const { readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { DATABASE_CONFIG } = require('../dist/infrastructure/database/database.module');
const { validateEnvironment } = require('../dist/infrastructure/config/environment');
const { configureHttp } = require('../dist/infrastructure/http/configure-http');
const { createOpenApiDocument } = require('../dist/infrastructure/http/openapi');
/**
 * Создаёт artifacts из production AppModule либо сравнивает с текущим JSON при --check.
 * @returns {Promise<void>} Завершение записи или успешного побайтового сравнения.
 * @throws Ошибки Nest graph/build assets, несовпадение artifact или filesystem I/O.
 * Dummy validated config исключает зависимость generation от .env/DB/Docker.
 * HTTP graph создаётся без lifecycle init, но pool/DI resources закрываются finally.
 */
async function generate() {
  if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: generate-openapi.cjs [--check]');
  // TestingModule здесь нужен только для config override. Controllers остаются
  // настоящими production, test fixture endpoints в graph не добавляются.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DATABASE_CONFIG)
    .useValue(validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://offline@127.0.0.1:1/offline' })).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    // OnModuleInit соединяется с БД, поэтому app.init/listen здесь принципиально не вызываются.
    configureHttp(app);
    // Стабильные formatting/newline и отсутствие timestamp позволяют проверять bytes diff в test:prepare.
    const contents = `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`;
    const path = resolve(__dirname, '../../../docs/contracts/openapi.json');
    if (process.argv.includes('--check')) {
      // Missing output — такой же drift, как устаревший JSON; другие I/O ошибки не маскируем.
      const previous = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (previous !== contents) throw new Error('OpenAPI differs. Run pnpm openapi:generate');
    } else await writeFile(path, contents);
  } finally { await app.close(); }
}
// Ненулевой exit code останавливает generation gate; успешный check никогда не перезаписывает файл.
generate().catch(error => { console.error(error.message); process.exitCode = 1; });
