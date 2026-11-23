/** @file WMS-603: SOPS/age bootstrap вне Argo render; plaintext и private keys не попадают в Git/evidence. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { randomBytes } = require('node:crypto');
/** Возвращает только encrypted document и безопасные evidence flags; пароли принадлежат private session. */
function prepareSecrets(session, tools) {
  const { run, directory, apply } = session;
  const key = path.join(directory, 'operator.agekey');
  const backup = path.join(directory, 'operator-backup.agekey');
  run(tools.ageKeygen, ['-o', key]);
  fs.chmodSync(key, 0o600);
  const recipient = run(tools.ageKeygen, ['-y', key]).trim();
  const password = randomBytes(24).toString('hex');
  const runtimePassword = randomBytes(24).toString('hex');
  const secret = (name, data) => ({
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: { name, namespace: session.namespace },
    stringData: data,
  });
  const document = {
    apiVersion: 'v1',
    kind: 'List',
    items: [
      secret('warehouse-postgres', { POSTGRES_PASSWORD: password }),
      secret('warehouse-migration', {
        DATABASE_URL: `postgresql://warehouse:${password}@postgres:5432/warehouse`,
      }),
      secret('warehouse-runtime', {
        DATABASE_URL: `postgresql://wms_runtime:${runtimePassword}@postgres:5432/warehouse`,
      }),
    ],
  };
  // Явный --age и private cwd исключают чтение checkout config. run передаёт только фиксированный SOPS key file.
  const config = path.join(directory, 'sops-config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      creation_rules: [{ age: recipient, encrypted_regex: '^(data|stringData)$' }],
    }),
    { mode: 0o600 },
  );
  // Bootstrap и restore используют одну policy encryption; новые DB URLs не могут обойти encrypted_regex.
  // Без file argument SOPS читает исходный stdin. На Linux повторное открытие /dev/stdin
  // не работает с socket, который Node создаёт для child_process input (ENXIO).
  const encryptDocument = () =>
    run(
      tools.sops,
      [
        '--config',
        config,
        'encrypt',
        '--age',
        recipient,
        '--encrypted-regex',
        '^(data|stringData)$',
        '--input-type',
        'json',
        '--output-type',
        'json',
        '--filename-override',
        path.join(directory, 'secrets.json'),
      ],
      JSON.stringify(document),
    );
  const encrypted = encryptDocument();
  assert.ok(!encrypted.includes(password) && !encrypted.includes(runtimePassword));
  const file = path.join(directory, 'secrets.enc.json');
  fs.writeFileSync(file, encrypted, { mode: 0o600 });
  // SOPS decrypt использует SOPS_AGE_KEY_FILE, а не --age recipient. Отдельный exec environment не наследует ambient SOPS_*.
  const { execFileSync } = require('node:child_process');
  function decrypted(identity) {
    const env = Object.fromEntries(
      Object.entries(session.env).filter(([name]) => !name.startsWith('SOPS_')),
    );
    env.SOPS_AGE_KEY_FILE = identity;
    try {
      return execFileSync(
        tools.sops,
        ['decrypt', '--input-type', 'json', '--output-type', 'json', file],
        { env, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch {
      throw Error('Secret decryption failed');
    }
  }
  assert.ok(isDeepStrictEqual(JSON.parse(decrypted(key)), document), 'Secret roundtrip mismatch');
  const wrong = path.join(directory, 'wrong.agekey');
  run(tools.ageKeygen, ['-o', wrong]);
  assert.throws(() => decrypted(wrong), /Secret decryption failed/);
  fs.copyFileSync(key, backup);
  fs.chmodSync(backup, 0o600);
  fs.rmSync(key);
  assert.throws(() => decrypted(key), /Secret decryption failed/);
  fs.copyFileSync(backup, key);
  fs.chmodSync(key, 0o600);
  assert.ok(isDeepStrictEqual(JSON.parse(decrypted(key)), document), 'Secret roundtrip mismatch');
  apply(JSON.parse(decrypted(key)));
  return {
    password,
    runtimePassword,
    key,
    recipient,
    encrypted,
    selectRestoredDatabase(database) {
      assert.ok(
        /^warehouse_restore_[a-f0-9]{8}$/.test(database),
        'Separate restored database required',
      );
      for (const item of document.items) {
        if (item.stringData.DATABASE_URL) {
          const url = new URL(item.stringData.DATABASE_URL);
          url.pathname = '/' + database;
          item.stringData.DATABASE_URL = url.toString();
        }
      }
      const next = encryptDocument();
      assert.ok(
        !next.includes(password) && !next.includes(runtimePassword),
        'Ciphertext must not contain credentials',
      );
      fs.writeFileSync(file, next, { mode: 0o600 });
      const decoded = JSON.parse(decrypted(key));
      assert.ok(isDeepStrictEqual(decoded, document), 'Restored database secret roundtrip');
      apply(decoded);
      return next;
    },
    proof: {
      roundtrip: true,
      wrongKeyRejected: true,
      restoredKeyWorks: true,
      keyOutsideGit: true,
      plaintextOutsideManifestGeneration: true,
    },
  };
}
module.exports = { prepareSecrets };
