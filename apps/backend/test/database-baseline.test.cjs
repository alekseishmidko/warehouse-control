/**
 * @file Явная dev-проверка реальной Compose БД: migrate twice, persistence/restart и pool shutdown.
 * Не Testcontainers harness WMS-102. Перезапускает только postgres данного Compose-проекта.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');
const { loadEnvironment } = require('../dist/infrastructure/config/environment');

test('local baseline migrates repeatedly and survives postgres restart', { timeout: 90000 }, async () => {
  const config = loadEnvironment();
  const url = new URL(config.databaseUrl);
  assert.equal(config.nodeEnv, 'development', 'dev-only database verification');
  assert.equal(url.hostname, '127.0.0.1', 'verification must target local Compose');
  assert.equal(url.port, process.env.POSTGRES_PORT ?? '15432');
  assert.equal(url.pathname, `/${process.env.POSTGRES_DB ?? 'warehouse'}`);
  const migrate = resolve(__dirname, '../dist/infrastructure/database/migrate.js');
  const key = `wms101-check-${randomUUID()}`;
  const poolOptions = { connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 };
  let pool = new Pool(poolOptions);
  try {
    // Timeout и выход CLI подтверждают, что migrator не оставляет открытый pool.
    execFileSync(process.execPath, [migrate], { timeout: 15000, stdio: 'pipe' });
    const first = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
    const journal = JSON.parse(readFileSync(resolve(__dirname, '../drizzle/meta/_journal.json'), 'utf8'));
    assert.equal(first.rows[0].count, journal.entries.length);
    execFileSync(process.execPath, [migrate], { timeout: 15000, stdio: 'pipe' });
    const repeated = await pool.query('select count(*)::int as count from drizzle.__drizzle_migrations');
    assert.equal(repeated.rows[0].count, first.rows[0].count);
    await pool.query('insert into application_metadata (key, value) values ($1, $2)', [key, 'persistence-probe']);
    await pool.end();
    execFileSync('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose/compose.yaml',
      'restart', 'postgres'], { cwd: resolve(__dirname, '../../..'), timeout: 30000, stdio: 'pipe' });
    pool = new Pool(poolOptions);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await pool.query('select 1'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, 'PostgreSQL did not recover after restart');
    const persisted = await pool.query('select value from application_metadata where key = $1', [key]);
    assert.equal(persisted.rows[0]?.value, 'persistence-probe');
    execFileSync(process.execPath, [resolve(__dirname, '../dist/infrastructure/database/check.js')],
      { timeout: 15000, stdio: 'pipe' });
  } catch {
    // Не выводим pg errors/child stderr, которые могут содержать параметры подключения.
    throw new Error('Local database baseline verification failed; inspect Compose health and migrations');
  } finally {
    if (!pool.ended) {
      try { await pool.query('delete from application_metadata where key = $1', [key]); }
      catch { throw new Error('Could not clean up local baseline probe; inspect Compose database'); }
      finally { await pool.end(); }
    }
  }
});
