/**
 * @file WMS-112: сборка без cache из чистого context; создаёт временные файлы и локальный image.
 * Подкладывает уникальный fake secret в исключённые host-файлы, затем проверяет все layers итогового image.
 * Это проверка исключения данных, а не универсальный поиск секретов/уязвимостей. Публикации в registry нет.
 */
const { execFileSync } = require('node:child_process');
const {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  createReadStream,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');

/** Копирует только собственные build inputs во временный каталог; реальные credentials не читает.
 * @returns После сборки, проверки layers/config и удаления context/archive.
 * @throws Ошибка Docker, таймаут или assertion; внешний catch выдаёт безопасную ошибку и exit=1.
 * Локальный tag warehouse-backend:local обновляется; Docker cache/image после проверки остаются. */
async function main() {
  const temp = mkdtempSync(join(tmpdir(), 'wms112-image-'));
  const context = join(temp, 'context');
  const archive = join(temp, 'image.tar');
  const canary = `WMS112_FAKE_SECRET_${randomUUID()}`;
  try {
    const inputs = [
      '.dockerignore',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'apps/backend/package.json',
      'apps/backend/Dockerfile',
      'apps/backend/nest-cli.json',
      'apps/backend/tsconfig.json',
      'apps/backend/tsconfig.build.json',
      'apps/backend/src',
      'apps/backend/drizzle',
    ];
    for (const path of inputs) {
      mkdirSync(dirname(join(context, path)), { recursive: true });
      cpSync(join(root, path), join(context, path), { recursive: true });
    }
    // Синтетические host artifacts обнаруживают регрессию исключений контекста/копирования.
    // Здесь нет настоящего секрета: уникальная строка нужна только для точного поиска.
    for (const path of [
      '.env',
      '.git/config',
      'node_modules/canary',
      'apps/backend/dist/canary',
      'apps/backend/test/canary',
      '.env.private-key',
    ]) {
      mkdirSync(dirname(join(context, path)), { recursive: true });
      writeFileSync(join(context, path), canary);
    }
    console.log('Building from clean inputs with --no-cache (no host install/dist required)');
    execFileSync(
      'docker',
      [
        'build',
        '--no-cache',
        '-f',
        'apps/backend/Dockerfile',
        '-t',
        'warehouse-backend:local',
        '.',
      ],
      { cwd: context, timeout: 240000, stdio: 'inherit' },
    );
    // docker save включает все layers итогового image: удаление секрета в следующем слое
    // не скрыло бы его из этой проверки. Промежуточные build stages отдельно не сканируются.
    execFileSync('docker', ['image', 'save', '-o', archive, 'warehouse-backend:local'], {
      timeout: 60000,
      stdio: 'pipe',
    });
    let tail = Buffer.alloc(0);
    const needle = Buffer.from(canary);
    for await (const chunk of createReadStream(archive)) {
      const data = Buffer.concat([tail, chunk]);
      assert.ok(!data.includes(needle), 'fake secret leaked into an image layer');
      // Сохраняем хвост: искомая строка может пересечь границу двух chunks потока.
      tail = data.subarray(Math.max(0, data.length - needle.length));
    }
    const info = JSON.parse(
      execFileSync(
        'docker',
        ['image', 'inspect', 'warehouse-backend:local', '--format', '{{json .Config}}'],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    assert.equal(info.User, 'node');
    assert.deepEqual(info.Entrypoint, ['node']);
    assert.deepEqual(info.Cmd, ['dist/main.js']);
    assert.ok(
      !info.Env.some((value) =>
        /^(DATABASE_URL|POSTGRES_PASSWORD|CONTAINER_DATABASE_URL)=/.test(value),
      ),
    );
    console.log(
      'PASS clean no-cache build; all final layers exclude fake secret; no DB credentials in image config; non-root exec entrypoint',
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('Docker image verification failed');
  process.exitCode = 1;
});
