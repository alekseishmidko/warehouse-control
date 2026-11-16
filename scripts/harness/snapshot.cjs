/** @file Content-addressed снимок Git inputs, включая dirty/untracked/deleted files и локальные env; значения secrets не сохраняются. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
/** SHA256 bytes/string для сравнения inputs/logs; не цифровая подпись доверенного исполнителя. */
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
/** Выполняет фиксированные argv Git внутри checkout без shell interpolation. */
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const statePrefix = 'artifacts/harness/';
/** Git перечисляет исходники, а не build output; tracked ignored files всё равно включаются. */
function snapshot(root) {
  const files = new Set(
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  );
  for (const dir of ['', 'apps/backend', 'apps/web']) {
    const absolute = path.join(root, dir);
    if (fs.existsSync(absolute))
      for (const name of fs.readdirSync(absolute))
        if (/^\.env(?:\.|$)/.test(name)) files.add(path.posix.join(dir, name));
  }
  const tracked = git(root, ['ls-files', 'artifacts/harness']);
  if (tracked) throw Error('Harness state must not be tracked');
  const entries = [...files]
    .filter((f) => !f.startsWith(statePrefix))
    .sort()
    .map((file) => {
      const absolute = path.join(root, file);
      try {
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) return [file, 'symlink', hash(fs.readlinkSync(absolute))];
        if (!stat.isFile()) throw Error('Unsupported input type: ' + file);
        return [file, stat.mode & 0o111, hash(fs.readFileSync(absolute))];
      } catch (error) {
        if (error.code === 'ENOENT') return [file, 'deleted'];
        throw error;
      }
    });
  const head = git(root, ['rev-parse', 'HEAD']);
  return { head, digest: hash(JSON.stringify({ head, entries })), files: entries };
}
/** Запись input во время команды консервативно делает результат stale, даже если байты вернули назад.
 * Watch не является защитой от привилегированного противника/ненадёжного network FS.
 */
function watchInputs(root, inputs) {
  const known = new Set(inputs.files.map((row) => row[0]));
  let changed = false;
  let failed = false;
  const watcher = fs.watch(root, { recursive: true }, (_event, name) => {
    if (!name) {
      changed = true;
      return;
    }
    const file = String(name).split(path.sep).join('/');
    if (file.startsWith(statePrefix)) return;
    if (known.has(file)) {
      changed = true;
      return;
    }
    if (
      file
        .split('/')
        .some((p) =>
          [
            '.git',
            'node_modules',
            'dist',
            '.test-dist',
            'coverage',
            'artifacts',
            '.idea',
            '.agents',
            '.codex',
            'test-results',
            'playwright-report',
          ].includes(p),
        )
    )
      return;
    if (spawnSync('git', ['check-ignore', '-q', '--', file], { cwd: root }).status !== 0)
      changed = true;
  });
  watcher.on('error', () => {
    failed = true;
    changed = true;
  });
  return { changed: () => changed, failed: () => failed, close: () => watcher.close() };
}
module.exports = { snapshot, watchInputs, hash, git };
