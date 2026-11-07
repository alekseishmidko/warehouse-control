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
const web = process.argv.includes('--web');
const app = web ? 'web' : 'backend';
const image = `warehouse-${app}:local`;

/** Копирует только собственные build inputs во временный каталог; реальные credentials не читает.
 * @returns После сборки, проверки layers/config и удаления context/archive.
 * @throws Ошибка Docker, таймаут или assertion; внешний catch выдаёт безопасную ошибку и exit=1.
 * Локальный tag warehouse-backend:local (или warehouse-web:local с --web) обновляется;
 * Docker cache/image после проверки остаются. */
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
      `apps/${app}/package.json`,
      `apps/${app}/Dockerfile`,
      `apps/${app}/tsconfig.json`,
      `apps/${app}/src`,
      ...(web
        ? ['apps/web/vite.config.ts', 'apps/web/index.html', 'apps/web/server/static-server.cjs']
        : [
            'apps/backend/nest-cli.json',
            'apps/backend/tsconfig.build.json',
            'apps/backend/drizzle',
          ]),
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
      'apps/web/dist/canary',
      'apps/web/test/canary',
      '.env.private-key',
    ]) {
      mkdirSync(dirname(join(context, path)), { recursive: true });
      writeFileSync(join(context, path), canary);
    }
    console.log('Building from clean inputs with --no-cache (no host install/dist required)');
    execFileSync(
      'docker',
      ['build', '--no-cache', '-f', `apps/${app}/Dockerfile`, '-t', image, '.'],
      { cwd: context, timeout: 240000, stdio: 'inherit' },
    );
    // docker save включает все layers итогового image: удаление секрета в следующем слое
    // не скрыло бы его из этой проверки. Промежуточные build stages отдельно не сканируются.
    execFileSync('docker', ['image', 'save', '-o', archive, image], {
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
      execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .Config}}'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    );
    assert.equal(info.User, 'node');
    assert.deepEqual(info.Entrypoint, web ? ['node', 'server/static-server.cjs'] : ['node']);
    if (!web) assert.deepEqual(info.Cmd, ['dist/main.js']);
    assert.ok(
      !info.Env.some((value) =>
        /^(DATABASE_URL|POSTGRES_PASSWORD|CONTAINER_DATABASE_URL)=/.test(value),
      ),
    );
    if (web) {
      // Проверяем настоящий ENTRYPOINT и SIGTERM, а не только декларацию User/Entrypoint.
      const container = execFileSync(
        'docker',
        ['run', '-d', '--read-only', '--network=none', image],
        {
          encoding: 'utf8',
        },
      ).trim();
      try {
        execFileSync(
          'docker',
          [
            'exec',
            container,
            'node',
            '-e',
            "const a=require('node:assert/strict'),f=require('node:fs');a.notEqual(process.getuid(),0);for(const p of ['src','test','node_modules','.env'])a.ok(!f.existsSync(p));fetch('http://127.0.0.1:8080/').then(async r=>{a.equal(r.status,200);a.match(await r.text(),/<html/)}).catch(()=>process.exitCode=1)",
          ],
          { timeout: 15000, stdio: 'pipe' },
        );
        execFileSync('docker', ['stop', '--time', '10', container], {
          timeout: 20000,
          stdio: 'pipe',
        });
        assert.equal(
          execFileSync('docker', ['inspect', '--format', '{{.State.ExitCode}}', container], {
            encoding: 'utf8',
          }).trim(),
          '0',
        );
      } finally {
        execFileSync('docker', ['rm', '-f', container], { stdio: 'pipe' });
      }
      console.log(
        'PASS web read-only non-root runtime GET / and SIGTERM exit=0; no source/test/node_modules/env',
      );
    }
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
