/**
 * @file WMS-112: изолированный Compose-проект и volume, настоящие HTTP/SQL и остановка SIGTERM.
 * Требует Docker и доступ к registry для сборки; root .env не загружается, dev volume не меняется.
 * Временные синтетические credentials хранятся в файле 0600; ошибки не раскрывают SQL и конфигурацию.
 */
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');

/** Запускает Docker с массивом аргументов без shell: ограничивает время и stdout четырьмя MB.
 * @param args Только аргументы, сформированные этим скриптом; произвольный пользовательский shell не принимается.
 * @param label Безопасное имя шага для ошибки, без конфигурации и credentials.
 * @param timeout Предел ожидания в миллисекундах; SIGKILL завершает клиент Docker, не подтверждает остановку контейнера.
 * @returns stdout при коде 0; иначе отклоняет promise. Очисткой проекта владеет main/finally. */
function run(args, label, timeout = 60000, input) {
  return new Promise((resolveResult, reject) => {
    // Shell environment имеет приоритет над --env-file в Compose. Убираем пересекающиеся
    // переменные, чтобы случайный export не направил тест в существующую БД/проект.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(POSTGRES_|CONTAINER_DATABASE_URL$|API_PORT$|BACKEND_IMAGE$|WORKER_|COMPOSE_|AUTH_|IDENTITY_BOOTSTRAP_)/.test(
            key,
          ),
      ),
    );
    const child = spawn('docker', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    // Credentials/cookie передаются stdin, не argv Docker/Node и не shell.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    let stdout = '';
    let bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (data) => {
      bytes += data.length;
      if (bytes < 4000000) stdout += data;
      else child.kill('SIGKILL');
    });
    // Читаем stderr, чтобы дочерний процесс не заблокировался на полном pipe.
    // В лог не копируем вывод с подставленной конфигурацией или ошибкой драйвера.
    child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error(label));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolveResult(stdout.trim()) : reject(new Error(label));
    });
  });
}
/** Повторяет наблюдение до выполнения условия, сверяя срок 30 секунд между чтениями и ожидая 250 ms.
 * Уже начатое чтение не отменяет: его отдельно ограничивает таймаут run.
 * @param read Асинхронное чтение БД или логов; ошибки чтения не скрываются.
 * @param predicate Условие успеха для полученного результата.
 * @returns Первый подходящий результат; превышение срока — ошибка, а не skip. */
async function until(read, predicate) {
  const deadline = Date.now() + 30000;
  do {
    const result = await read();
    if (predicate(result)) return result;
    await new Promise((r) => setTimeout(r, 250));
  } while (Date.now() < deadline);
  throw new Error('completion deadline exceeded');
}
/** Владеет временной средой, Compose-проектом и volume с новым UUID.
 * @returns После всех проверок и cleanup; любой неверный инвариант завершает CLI с кодом 1.
 * Побочные эффекты: локальная сборка image, контейнеры и синтетическая БД.
 * finally удаляет только свой проект/volume и tempfile; production/dev БД не очищается. */
async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'wms112-'));
  const project = `wms112-${randomUUID()}`;
  const envFile = join(temp, 'gate.env');
  const password = randomBytes(24).toString('hex');
  await writeFile(
    envFile,
    `POSTGRES_USER=warehouse\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=warehouse\nPOSTGRES_PORT=0\nAPI_PORT=0\nCONTAINER_DATABASE_URL=postgresql://warehouse:${password}@postgres:5432/warehouse\nBACKEND_IMAGE=warehouse-backend:local\nAUTH_ORIGIN=https://warehouse.local\nAUTH_SESSION_ABSOLUTE_SECONDS=600\nAUTH_SESSION_IDLE_SECONDS=300\n`,
    { mode: 0o600 },
  );
  const common = [
    'compose',
    '--project-name',
    project,
    '--env-file',
    envFile,
    '-f',
    'infra/compose/compose.yaml',
    '-f',
    'infra/compose/compose.app.yaml',
  ];
  /** Формирует Compose-вызов только из известных файлов; gate=true задаёт loopback auth origin
   * исключительно для loopback API. Common всегда содержит отдельные project-name и env-file. */
  const compose = (args, gate = false, timeout, input) =>
    run(
      [...common, ...(gate ? ['-f', 'infra/compose/compose.gate.yaml'] : []), ...args],
      `compose ${args[0]} failed`,
      timeout,
      input,
    );
  /** Выполняет доверенный код Node через exec в API-контейнере.
   * Это тестовый адаптер без shell, а не интерфейс выполнения произвольного пользовательского кода. */
  const node = (code, gate = true, input) =>
    compose(['exec', '-T', 'api', 'node', '-e', code], gate, undefined, input);
  /** Читает только фиксированные SELECT этого скрипта; значения передаются параметрами pg.
   * Пул закрывается в finally внутри контейнера; запись бизнес-данных выполняют штатные HTTP/seed сервисы. */
  const sql = async (query, values = []) =>
    JSON.parse(
      await node(
        `const {pool}=require('./dist/infrastructure/database/connection').createDatabaseConnection(process.env.DATABASE_URL);(async()=>{try{console.log(JSON.stringify((await pool.query(${JSON.stringify(query)},${JSON.stringify(values)})).rows));}finally{await pool.end();}})().catch(()=>process.exitCode=1);`,
      ),
    );
  /** Вызывает настоящий HTTP на loopback контейнера: guard, DTO и идемпотентность не подменяются.
   * Синтетический body сериализуется как JSON; возвращаются HTTP status и JSON body. */
  let browser;
  // JSON-команда и session capability идут stdin, в stdout драйвер не печатает cookie/пароли.
  const http = async (path, method = 'GET', body, key, gate = true) =>
    JSON.parse(
      await node(
        `(async()=>{
    const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
    const r=await fetch('http://127.0.0.1:3000'+input.path,{method:input.method,headers:{'content-type':'application/json',
      Origin:'http://127.0.0.1:3000','X-CSRF-Protection':'1',...(input.key?{'Idempotency-Key':input.key}:{}),
      ...(input.browser?{Cookie:input.browser.cookie,'X-CSRF-Token':input.browser.csrfToken}:{})},
      ...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
    console.log(JSON.stringify({status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}));
  })().catch(()=>process.exitCode=1);`,
        gate,
        JSON.stringify({ path, method, body, key, browser }),
      ),
    );
  /** Читает только State адресованного контейнера через ограниченный inspect format.
   * Config.Env и DATABASE_URL не выводятся; завершение проверяется по реальному ExitCode. */
  const state = async (service) => {
    const id = await compose(['ps', '-a', '-q', service]);
    return JSON.parse(
      await run(['inspect', '--format', '{{json .State}}', id], 'container state failed'),
    );
  };
  let receiptId;
  try {
    // Сначала проверяем обычный production-режим: анонимный доступ к business запрещён.
    // Подставленная среда берётся только из созданного нами env-file, а не из root .env.
    await compose(['up', '-d', '--build', '--wait', 'api', 'worker'], false, 120000);
    assert.equal((await http('/health', 'GET', undefined, undefined, false)).status, 200);
    const address = await compose(['port', 'api', '3000']);
    assert.match(address, /^127\.0\.0\.1:[0-9]+$/);
    assert.equal(
      (await fetch(`http://${address}/health`, { signal: AbortSignal.timeout(3000) })).status,
      200,
    );
    assert.equal((await http('/api/v1/receipts', 'POST', {}, randomUUID(), false)).status, 401);
    console.log('PASS default API health / anonymous business access denied');
    // SIGTERM получает Node PID 1 напрямую. Ожидаем exit=0: SIGKILL дал бы 137
    // и не доказал бы, что worker завершил poll/drain/закрытие пула.
    await compose(['stop', 'worker']);
    assert.equal((await state('worker')).ExitCode, 0);
    await compose(
      ['up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'api'],
      true,
      120000,
    );
    const fixture = JSON.parse(
      await compose(
        [
          'exec',
          '-T',
          '-e',
          'NODE_ENV=development',
          'api',
          'node',
          'dist/infrastructure/database/seed-dev.js',
        ],
        true,
      ),
    );
    const initialPassword = 'Gate-' + randomBytes(24).toString('hex');
    await compose(
      [
        'exec',
        '-T',
        '-e',
        'IDENTITY_BOOTSTRAP_ENABLED=true',
        'api',
        'node',
        'dist/modules/identity/bootstrap.js',
      ],
      true,
      undefined,
      JSON.stringify({ login: 'gate.admin', password: initialPassword }),
    );
    const signed = await http('/api/v1/auth/login', 'POST', {
      login: 'gate.admin',
      password: initialPassword,
    });
    assert.equal(signed.status, 200);
    browser = { cookie: signed.cookie, csrfToken: signed.body.csrfToken };
    // System admin не имеет складских прав автоматически: назначаем роль через настоящее защищённое API.
    assert.equal(
      (
        await http(
          `/api/v1/identity/users/${signed.body.user.id}/warehouses/${fixture.warehouseId}/roles`,
          'POST',
          { roles: ['warehouse_operator'] },
        )
      ).status,
      201,
    );
    const runtime = JSON.parse(
      await node(
        `const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),pid1:fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean),forbidden:['.env','src','test','.git'].filter(p=>fs.existsSync(p)),devDependencies:['typescript','jest','@nestjs/cli','prettier'].filter(p=>{try{require.resolve(p);return true;}catch{return false;}})}));`,
      ),
    );
    assert.ok(runtime.uid > 0);
    assert.deepEqual(runtime.pid1, ['node', 'dist/main.js']);
    assert.deepEqual(runtime.forbidden, []);
    assert.deepEqual(runtime.devDependencies, []);
    // Транзакциями владеет штатный HTTP-сценарий; SQL проверки видит только committed результат.
    // Тот же key обязан вернуть исходный response; новый key для posted документа — 409 без нового начисления.
    const draft = await http(
      '/api/v1/receipts',
      'POST',
      {
        warehouseId: fixture.warehouseId,
        receivingLocationId: fixture.receivingLocationId,
        lines: [{ productId: fixture.productId, quantity: 10 }],
      },
      randomUUID(),
    );
    assert.equal(draft.status, 201);
    receiptId = draft.body.id;
    const key = randomUUID();
    const path = `/api/v1/receipts/${receiptId}/post`;
    const posted = await http(path, 'POST', {}, key);
    assert.equal(posted.status, 200);
    const repeated = await http(path, 'POST', {}, key);
    assert.deepEqual(repeated, posted);
    assert.equal((await http(path, 'POST', {}, randomUUID())).status, 409);
    /** Читает состояние одной новой приёмки/строки. Счётчики показывают дубликаты эффекта;
     * тест не повторяет алгоритм начисления или создания задания. */
    const observe = async () =>
      (
        await sql(
          `SELECT r.status, b.on_hand, b.reserved, d.status AS delivery,
      (SELECT count(*)::int FROM stock_movements m WHERE m.operation_id=l.id) AS movements,
      (SELECT count(*)::int FROM outbox_events e WHERE e.aggregate_type='receipt' AND e.aggregate_id=r.id) AS events,
      (SELECT count(*)::int FROM putaway_tasks t WHERE t.source_receipt_id=r.id) AS tasks,
      (SELECT count(*)::int FROM processed_events p WHERE p.event_id=r.posted_event_id) AS markers
      FROM receipts r JOIN receipt_lines l ON l.receipt_id=r.id
      JOIN stock_balances b ON b.product_id=l.product_id AND b.location_id=r.receiving_location_id AND b.warehouse_id=r.warehouse_id
      JOIN outbox_deliveries d ON d.event_id=r.posted_event_id WHERE r.id=$1`,
          [receiptId],
        )
      )[0];
    const pending = await observe();
    assert.deepEqual(pending, {
      status: 'posted',
      on_hand: 10,
      reserved: 0,
      delivery: 'pending',
      movements: 1,
      events: 1,
      tasks: 0,
      markers: 0,
    });
    console.log(`PASS worker stopped + posting replay: ${JSON.stringify(pending)}`);
    // Перезапускаем настоящий PostgreSQL, ждём health и сравниваем snapshot и имя volume.
    // Второй запуск мигратора должен успешно прочитать journal без повторного применения SQL.
    const volumeBefore = await compose(['ps', '-q', 'postgres']);
    const volume = JSON.parse(
      await run(['inspect', '--format', '{{json .Mounts}}', volumeBefore], 'volume inspect failed'),
    ).find((m) => m.Destination === '/var/lib/postgresql/data').Name;
    await compose(['restart', 'postgres']);
    await compose(['up', '-d', '--no-build', '--wait', 'postgres']);
    assert.deepEqual(await observe(), pending);
    await compose(['run', '--rm', '--no-deps', 'migrate']);
    const volumeAfterId = await compose(['ps', '-q', 'postgres']);
    const volumeAfter = JSON.parse(
      await run(
        ['inspect', '--format', '{{json .Mounts}}', volumeAfterId],
        'volume inspect failed',
      ),
    ).find((m) => m.Destination === '/var/lib/postgresql/data').Name;
    assert.equal(volumeAfter, volume);
    console.log(
      'PASS PostgreSQL restart preserves named volume + posting; repeat migration succeeds',
    );
    await compose(['up', '-d', '--no-build', '--no-deps', 'worker']);
    const complete = await until(observe, (result) => result.delivery === 'completed');
    assert.deepEqual(complete, { ...pending, delivery: 'completed', tasks: 1, markers: 1 });
    assert.deepEqual(await http(path, 'POST', {}, key), posted);
    await compose(['restart', 'worker']);
    assert.deepEqual(await observe(), complete);
    const workerId = await compose(['ps', '-q', 'worker']);
    assert.equal(
      await run(
        [
          'exec',
          workerId,
          'node',
          '-e',
          "process.stdout.write(require('node:fs').readFileSync('/proc/1/cmdline','utf8').replaceAll('\\0',' ').trim())",
        ],
        'worker PID check failed',
      ),
      'node dist/worker.js',
    );
    assert.ok(
      Number(
        await run(
          ['exec', workerId, 'node', '-e', 'process.stdout.write(String(process.getuid()))'],
          'worker UID check failed',
        ),
      ) > 0,
    );
    await until(
      async () => compose(['logs', '--no-color', 'worker']),
      (logs) => logs.includes('Worker ready'),
    );
    await compose(['stop', 'worker', 'api']);
    assert.equal((await state('worker')).ExitCode, 0);
    // После shutdown hooks Nest/Node может вернуть 0 или завершиться сигналом SIGTERM (143).
    // Код 137 означает SIGKILL и не считается успешным graceful shutdown.
    const apiExit = (await state('api')).ExitCode;
    assert.ok([0, 143].includes(apiExit), `unexpected API shutdown code ${apiExit}`);
    console.log(
      `PASS durable task + worker restart + API/worker SIGTERM: ${JSON.stringify(complete)}`,
    );
    console.log(
      `GATE 1 PASS receiptId=${receiptId}; runtime uid=${runtime.uid}; apiExit=${apiExit}; workerExit=0; no runtime dev dependencies`,
    );
  } finally {
    // Удаление volume ограничено UUID-проектом этого прогона, не warehouse-controller.
    // Даже assertion failure проходит через cleanup; жёсткое убийство самого driver finally не гарантирует.
    try {
      await compose(['down', '--volumes', '--remove-orphans'], true, 60000);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}
main().catch((error) => {
  console.error(`Docker gate failed: ${error.message}`);
  process.exitCode = 1;
});
