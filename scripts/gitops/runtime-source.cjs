/** @file WMS-604: отдельный digest Docker build inputs включает untracked/ignored files; test-only изменения не меняют runtime. */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../harness/snapshot.cjs');
// Перечень сверяется с COPY/build обоих Dockerfile; runtime helper также является build input.
const runtimeInputs = [
  'apps/backend/src',
  'apps/backend/drizzle',
  'apps/backend/package.json',
  'apps/backend/tsconfig*.json',
  'apps/backend/nest-cli.json',
  'apps/backend/Dockerfile',
  'apps/web/src',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'apps/web/index.html',
  'apps/web/server/static-server.cjs',
  'apps/web/Dockerfile',
  'package.json',
  'tsconfig.base.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'patches',
  '.dockerignore',
  'scripts/image-release/cpp-runtime.cjs',
  'docs/contracts',
];
/** Digest фактических build inputs, включая новые ignored files; содержимое файлов не сохраняется в evidence. */
function runtimeSourceSnapshot(root = path.resolve('.')) {
  const ignored = execFileSync(
    'git',
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...runtimeInputs],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  );
  if (ignored) throw Error('Ignored runtime build input rejected');
  const names = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--', ...runtimeInputs],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  )
    .split('\0')
    .filter(Boolean);
  const entries = [...new Set(names)].sort().map((name) => {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) return [name, 'deleted'];
    const stat = fs.lstatSync(file);
    return [
      name,
      stat.mode & 0o777,
      hash(stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file)),
    ];
  });
  return hash(JSON.stringify(entries));
}
/** Проверяет, что build/scan/load используют тот же runtime source; stale tag не заменяет fresh build. */
function verifyRuntimeSource(expected, root = path.resolve('.')) {
  try {
    if (!/^[a-f0-9]{64}$/.test(expected) || runtimeSourceSnapshot(root) !== expected)
      throw Error('Different runtime inputs');
  } catch {
    throw Error('Runtime source changed since checked build');
  }
}
module.exports = { verifyRuntimeSource, runtimeSourceSnapshot };
