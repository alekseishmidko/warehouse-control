/** @file WMS-303: настоящий NGF/TLS/static SPA/auth/browser gate внутри disposable WMS-302 стенда. */
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { randomBytes, createHash, X509Certificate } = require('node:crypto');
const assert = require('node:assert/strict');
const { canonicalImage } = require('./kind-image.cjs');
/** Поднимает gateway и проверяет TLS chain через Node CA, затем UI с ограниченным test-only SPKI pin. */
async function checkGateway({
  run,
  k,
  h,
  apply,
  until,
  temp,
  cluster,
  context,
  env,
  namespace,
  config,
  values,
  helm,
  kubectl,
  kind,
}) {
  let forward, browser;
  const loginPassword = 'Gateway-' + randomBytes(24).toString('hex');
  try {
    // Отрицательные templates проверяют отказ до создания ресурсов, положительный — имя другого release.
    const template = (settings) =>
      run(helm, ['template', 'custom', 'infra/helm/warehouse', '-f', values, '--set', settings]);
    assert.throws(() => template('gateway.enabled=true'));
    assert.throws(() => template('web.enabled=true,web.image.digest=latest'));
    const preview = template(
      'gateway.enabled=true,web.enabled=true,web.image.digest=' + config.image.digest,
    );
    assert.ok(preview.includes('name: custom-web'));
    assert.ok(!preview.includes('URLRewrite') && !preview.includes('tls.key:'));
    run(
      'docker',
      ['build', '-f', 'apps/web/Dockerfile', '-t', 'warehouse-web:wms303', '.'],
      undefined,
      240000,
    );
    run(kind, ['load', 'docker-image', 'warehouse-web:wms303', '--name', cluster]);
    const digest = canonicalImage(run, cluster, 'warehouse-web:wms303', temp, 'web');
    // Явно переданный cache принимается только с закреплённым hash; это dependency input, не skip/fallback теста.
    const crds = process.env.WMS_GATEWAY_CRDS
      ? readFileSync(process.env.WMS_GATEWAY_CRDS, 'utf8')
      : run(kubectl, [
          'kustomize',
          'https://github.com/nginx/nginx-gateway-fabric/config/crd/gateway-api/standard?ref=v2.8.1',
        ]);
    assert.equal(
      createHash('sha256').update(crds.trim()).digest('hex'),
      'e6d95c97d798bd68f8838a95ad4db14bfea0ff7e7d1c8ce2fb7f6ad7fd9593d3',
    );
    run(kubectl, ['--context', context, 'apply', '-f', '-'], crds);
    run(helm, [
      'install',
      'ngf',
      'oci://ghcr.io/nginx/charts/nginx-gateway-fabric',
      '--version',
      '2.8.1',
      '--create-namespace',
      '-n',
      'nginx-gateway',
      '--kube-context',
      context,
      '--wait',
      '--timeout',
      '180s',
    ]);
    // CA и leaf живут только в temp. SAN проверяется настоящим TLS client, private key идёт kube API stdin.
    const caKey = join(temp, 'ca.key'),
      ca = join(temp, 'ca.crt'),
      key = join(temp, 'tls.key'),
      cert = join(temp, 'tls.crt'),
      csr = join(temp, 'tls.csr'),
      ext = join(temp, 'tls.ext');
    run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      caKey,
      '-out',
      ca,
      '-days',
      '1',
      '-subj',
      '/CN=WMS Gate CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    ]);
    run('openssl', [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      csr,
      '-subj',
      '/CN=warehouse.local',
    ]);
    writeFileSync(
      ext,
      'subjectAltName=DNS:warehouse.local\nbasicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
    );
    run('openssl', [
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      ca,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      cert,
      '-days',
      '1',
      '-extfile',
      ext,
    ]);
    apply({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'warehouse-tls' },
      type: 'kubernetes.io/tls',
      data: {
        'tls.crt': readFileSync(cert).toString('base64'),
        'tls.key': readFileSync(key).toString('base64'),
      },
    });
    config.web = {
      enabled: true,
      image: { repository: 'warehouse-web', digest, pullPolicy: 'Never' },
    };
    config.gateway = {
      enabled: true,
      hostname: 'warehouse.local',
      tlsSecret: 'warehouse-tls',
      webService: 'warehouse-web',
      webPort: 8080,
      redirectPort: 443,
    };
    writeFileSync(values, JSON.stringify(config));
    h([
      'upgrade',
      'warehouse',
      'infra/helm/warehouse',
      '-f',
      values,
      '--wait',
      '--timeout',
      '180s',
    ]);
    k(['wait', '--for=condition=Programmed', 'gateway/warehouse-gateway', '--timeout=180s']);
    const service = await until(
      () =>
        JSON.parse(k(['get', 'services', '-o', 'json'])).items.find(
          (s) =>
            s.spec.ports?.some((p) => p.port === 443) && s.spec.ports?.some((p) => p.port === 80),
        ),
      Boolean,
    );
    // Programmed подтверждает принятую конфигурацию, а не готовность data-plane Pod.
    const deployments = JSON.parse(k(['get', 'deployments', '-o', 'json'])).items;
    const dataPlane = deployments.find((d) =>
      Object.entries(service.spec.selector).every(
        ([key, value]) => d.spec.template.metadata.labels[key] === value,
      ),
    );
    assert.ok(dataPlane, 'Gateway data-plane Deployment missing');
    k(['rollout', 'status', 'deployment/' + dataPlane.metadata.name, '--timeout=120s']);
    // Port-forward ограничен localhost и живёт до finally. ОС выбирает свободные порты без записи /etc/hosts.
    const ports = {};
    forward = spawn(
      kubectl,
      [
        '--context',
        context,
        '-n',
        namespace,
        'port-forward',
        'service/' + service.metadata.name,
        ':443',
        ':80',
        '--address',
        '127.0.0.1',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gateway port-forward timeout')), 30000);
      let output = '';
      forward.stdout.on('data', (chunk) => {
        output += chunk;
        for (const m of output.matchAll(/127\.0\.0\.1:(\d+) -> (\d+)/g)) ports[m[2]] = Number(m[1]);
        if (ports[80] && ports[443]) {
          clearTimeout(timer);
          resolve();
        }
      });
      forward.once('error', () => {
        clearTimeout(timer);
        reject(new Error('port-forward spawn failed'));
      });
      forward.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('port-forward exited'));
      });
      forward.stderr.on('data', () => {});
    });
    const origin = 'https://warehouse.local:' + ports[443];
    config.auth.origin = origin;
    config.gateway.redirectPort = ports[443];
    writeFileSync(values, JSON.stringify(config));
    h([
      'upgrade',
      'warehouse',
      'infra/helm/warehouse',
      '-f',
      values,
      '--wait',
      '--timeout',
      '180s',
    ]);
    /** Проверяет hostname и цепочку нашей CA. Headers/credentials передаются в памяти, в argv не попадают. */
    const request = (path, options = {}) =>
      new Promise((resolve, reject) => {
        const tls = options.http ? http : https;
        const req = tls.request(
          {
            hostname: 'warehouse.local',
            family: 4,
            lookup: (_host, _opts, cb) => cb(null, '127.0.0.1', 4),
            port: options.http ? ports[80] : ports[443],
            path,
            method: options.method ?? 'GET',
            ca: options.untrusted ? undefined : readFileSync(ca),
            headers: options.headers,
          },
          (r) => {
            let body = '';
            r.on('data', (c) => (body += c));
            r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }));
          },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('HTTPS timeout')));
        req.end(options.body);
      });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        ready = (await request('/')).status === 200;
        if (ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, 'TLS/static origin unavailable');
    await assert.rejects(request('/', { untrusted: true }));
    assert.equal((await request('/api/v1/warehouses')).status, 401);
    assert.equal((await request('/api/v1/missing')).status, 404);
    const redirect = await request('/orders', {
      http: true,
      headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
    });
    assert.equal(redirect.status, 301);
    assert.equal(new URL(redirect.headers.location).hostname, 'warehouse.local');
    assert.equal(new URL(redirect.headers.location).port, String(ports[443]));
    assert.equal(
      (
        await request('/api/v1/warehouses', {
          headers: {
            'X-Forwarded-For': '127.0.0.1',
            'X-Forwarded-Proto': 'https',
            'X-Actor-Id': 'admin',
          },
        })
      ).status,
      401,
    );
    // Только admin fixture Pod получает migration Secret. Никаких временных grants runtime login.
    apply({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'gateway-fixture' },
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        containers: [
          {
            name: 'fixture',
            image: config.image.repository + '@' + config.image.digest,
            imagePullPolicy: 'Never',
            command: ['node', '-e', 'setInterval(()=>{},1000)'],
            env: [
              {
                name: 'DATABASE_URL',
                valueFrom: { secretKeyRef: { name: 'warehouse-migration', key: 'DATABASE_URL' } },
              },
              { name: 'NODE_ENV', value: 'development' },
              { name: 'AUTH_ORIGIN', value: origin },
              { name: 'AUTH_SESSION_ABSOLUTE_SECONDS', value: '600' },
              { name: 'AUTH_SESSION_IDLE_SECONDS', value: '300' },
            ],
          },
        ],
      },
    });
    k(['wait', '--for=condition=Ready', 'pod/gateway-fixture', '--timeout=120s']);
    const fixture = JSON.parse(
      k(['exec', 'gateway-fixture', '--', 'node', 'dist/infrastructure/database/seed-dev.js']),
    );
    k(
      [
        'exec',
        '-i',
        'gateway-fixture',
        '--',
        'env',
        'IDENTITY_BOOTSTRAP_ENABLED=true',
        'node',
        'dist/modules/identity/bootstrap.js',
      ],
      JSON.stringify({ login: 'gateway.admin', password: loginPassword }),
    );
    const signed = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
      body: JSON.stringify({ login: 'gateway.admin', password: loginPassword }),
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers['set-cookie'][0];
    assert.ok(cookie.startsWith('__Host-wms_session='));
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'])
      assert.ok(cookie.includes(flag));
    assert.ok(!/Domain=/i.test(cookie));
    const profile = JSON.parse(signed.body),
      auth = {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: cookie.split(';')[0],
        'X-CSRF-Token': profile.csrfToken,
      };
    assert.equal(
      (
        await request(
          '/api/v1/identity/users/' +
            profile.user.id +
            '/warehouses/' +
            fixture.warehouseId +
            '/roles',
          {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ roles: ['warehouse_supervisor'] }),
          },
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await request('/api/v1/receipts', {
          method: 'POST',
          headers: {
            ...auth,
            Origin: 'https://evil.example',
            'X-Forwarded-Host': 'warehouse.local',
            'X-Forwarded-Proto': 'https',
          },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/v1/receipts', {
          method: 'POST',
          headers: { ...auth, 'X-CSRF-Token': 'wrong' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/v1/auth/login', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
          body: JSON.stringify({ padding: 'x'.repeat(270000) }),
        })
      ).status,
      413,
    );
    console.log(
      'PASS NGF/TLS CA+hostname, redirect, prefix, Secure cookies, Origin/CSRF, forwarded spoof and 256KiB limit',
    );
    // Browser pin ограничен новым leaf test key. CA validation выше выполнялась без TLS bypass.
    const pin = createHash('sha256')
      .update(
        new X509Certificate(readFileSync(cert)).publicKey.export({ type: 'spki', format: 'der' }),
      )
      .digest('base64');
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--host-resolver-rules=MAP warehouse.local 127.0.0.1',
        '--no-proxy-server',
        '--ignore-certificate-errors-spki-list=' + pin,
      ],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(origin);
    await page.getByLabel('Логин', { exact: true }).fill('gateway.admin');
    await page.getByLabel('Пароль', { exact: true }).fill(loginPassword);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByLabel('Текущий склад', { exact: true }).selectOption(fixture.warehouseId);
    const open = async (name) => page.getByRole('link', { name, exact: true }).click();
    const command = async (label, path) => {
      const response = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
      );
      await page.getByRole('button', { name: label, exact: true }).click();
      const r = await response;
      assert.ok(r.ok(), 'UI command failed: ' + path);
      return r.json();
    };
    await open('Приёмка');
    await page
      .getByLabel('Ячейка приёмки', { exact: true })
      .selectOption(fixture.receivingLocationId);
    await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.productId);
    await page.getByLabel('Количество 1', { exact: true }).fill('10');
    const receipt = await command('Создать черновик', '/api/v1/receipts');
    await command('Провести приёмку', '/api/v1/receipts/' + receipt.id + '/post');
    await open('Размещение');
    for (let i = 0; i < 30 && (await page.getByLabel(/Ячейка хранения для/).count()) === 0; i++) {
      await page.getByRole('button', { name: 'Обновить задания', exact: true }).click();
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.getByLabel(/Ячейка хранения для/).selectOption(fixture.storageLocationId);
    const executed = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /putaway-tasks.*execute/.test(r.url()),
    );
    await page.getByRole('button', { name: 'Подтвердить размещение', exact: true }).click();
    assert.ok((await executed).ok());
    await open('Заказы');
    await page.getByLabel('Товар 1', { exact: true }).selectOption(fixture.productId);
    await page.getByLabel('Количество 1', { exact: true }).fill('3');
    const order = await command('Создать черновик', '/api/v1/orders');
    await command('Подтвердить заказ', '/api/v1/orders/' + order.id + '/confirm');
    await command(
      'Зарезервировать выбранное количество',
      '/api/v1/orders/' + order.id + '/reserve',
    );
    const task = await command(
      'Создать задание сборки',
      '/api/v1/orders/' + order.id + '/picking-tasks',
    );
    await open('Сборка');
    await page.getByRole('button', { name: new RegExp('Сборка #' + task.id.slice(0, 8)) }).click();
    await command('Принять задание', '/api/v1/picking-tasks/' + task.id + '/start');
    await page.getByLabel('Фактически собрано сейчас', { exact: true }).fill('3');
    await page
      .getByLabel('Ячейка отгрузки', { exact: true })
      .selectOption(fixture.shippingLocationId);
    await command('Зафиксировать сборку', '/api/v1/picking-tasks/' + task.id + '/confirm');
    await open('Заказы');
    await page.getByRole('button', { name: new RegExp('Заказ #' + order.id.slice(0, 8)) }).click();
    await page.getByLabel('Количество к отгрузке', { exact: true }).fill('3');
    const shipment = await command('Создать отгрузку', '/api/v1/orders/' + order.id + '/shipments');
    await open('Отгрузка');
    await page
      .getByRole('button', { name: new RegExp('Отгрузка #' + shipment.id.slice(0, 8)) })
      .click();
    await command('Подтвердить отгрузку', '/api/v1/shipments/' + shipment.id + '/post');
    await open('Обзор остатков');
    await require('@playwright/test')
      .expect(page.getByRole('row', { name: /Хранение 7 0 7/ }))
      .toBeVisible();
    await page.goto(origin + '/unknown-page');
    // Полная навигация создаёт новый workspace: склад выбирается явно, как после открытия новой вкладки.
    await page.getByLabel('Текущий склад', { exact: true }).selectOption(fixture.warehouseId);
    await require('@playwright/test')
      .expect(page.getByRole('heading', { name: 'Страница не найдена' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await require('@playwright/test')
      .expect(page.getByLabel('Логин', { exact: true }))
      .toBeVisible();
    k(['scale', 'deployment/warehouse-api', '--replicas=0']);
    await until(
      () =>
        JSON.parse(k(['get', 'pods', '-l', 'app.kubernetes.io/component=api', '-o', 'json'])).items
          .length,
      (n) => n === 0,
    );
    const unavailable = await request('/api/v1/warehouses');
    assert.ok([502, 503].includes(unavailable.status));
    assert.equal((await request('/')).status, 200);
    k(['scale', 'deployment/warehouse-api', '--replicas=1']);
    k(['rollout', 'status', 'deployment/warehouse-api', '--timeout=120s']);
    console.log(
      'PASS Chromium HTTPS login → receive10 → putaway → reserve/pick/ship3 → stock7; unknown page/API and upstream failure',
    );
  } finally {
    await browser?.close();
    if (forward && forward.exitCode === null) {
      const closed = new Promise((r) => forward.once('exit', r));
      forward.kill('SIGTERM');
      await closed;
    }
  }
}
module.exports = { checkGateway };
