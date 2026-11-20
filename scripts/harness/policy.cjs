/** @file Закрытый каталог локальных gates и task validation. Task не может передать произвольную shell command. */
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./snapshot.cjs');
const gates = {
  install: ['deps:check'],
  pr: ['check:pr'],
  image: ['docker:image-check'],
  webImage: ['docker:image-check', '--web'],
  docker: ['docker:gate'],
  kubernetes: ['kubernetes:gate'],
  kafka: ['kafka:gate'],
  registry: ['registry:gate'],
  // Любой build gate может изменить local tag: scan проверяет окончательные bytes.
  imageScan: ['images:scan'],
};
/** Paths разрешены только внутри checkout, symlink наружу не превращается в config input. */
function localFile(root, name) {
  if (typeof name !== 'string' || path.isAbsolute(name) || name.split(/[\\/]/).includes('..'))
    throw Error('Expected repository-relative file');
  const proposed = path.resolve(root, name);
  let cursor = root;
  for (const part of name.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Expected source file without symlinks');
  }
  const relative = path.relative(root, proposed).split(path.sep).join('/');
  const sources = execFileText(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    relative,
  ]).split('\0');
  if (!sources.includes(relative)) throw Error('Expected Git source input');
  const result = fs.realpathSync(proposed);
  if (!result.startsWith(root + path.sep) || !fs.statSync(result).isFile())
    throw Error('File outside repository');
  return result;
}
/** Валидирует source task и наличие AC references; содержание tests не считается доказанным этой проверкой. */
function readTask(root, file) {
  const task = JSON.parse(fs.readFileSync(localFile(root, file), 'utf8'));
  if (
    task.version !== 1 ||
    !/^[-a-z0-9]{1,64}$/.test(task.id) ||
    typeof task.request !== 'string' ||
    !task.request.trim() ||
    typeof task.issuedBy !== 'string' ||
    !task.issuedBy.trim()
  )
    throw Error('Invalid task identity/request');
  if (
    !/^[a-f0-9]{40}$/.test(task.base) ||
    git(root, ['rev-parse', task.base + '^{commit}']) !== task.base
  )
    throw Error('Task requires exact accepted base commit');
  if (!Array.isArray(task.criteria) || !task.criteria.length)
    throw Error('Acceptance criteria required');
  const ids = new Set();
  for (const ac of task.criteria) {
    if (
      typeof ac.id !== 'string' ||
      !ac.id.trim() ||
      ids.has(ac.id) ||
      typeof ac.statement !== 'string' ||
      !ac.statement.trim()
    )
      throw Error('Invalid/duplicate criterion');
    ids.add(ac.id);
    if (
      !Array.isArray(ac.tests) ||
      !ac.tests.length ||
      !ac.tests.every(
        (t) =>
          typeof t === 'string' && t.split('#').length === 2 && Boolean(t.split('#')[1].trim()),
      )
    )
      throw Error('Criterion requires file#test reference');
    for (const test of ac.tests) localFile(root, test.split('#')[0]);
    if (
      !Array.isArray(ac.gates) ||
      !ac.gates.length ||
      ac.gates.some((g) => !Object.hasOwn(gates, g))
    )
      throw Error('Unknown criterion gate');
  }
  return task;
}
/** check:pr обязателен всегда; task может только расширить набор, не отключить diff policy. */
function plan(root, task, inputs) {
  const changed = new Set(
    execFileText(root, ['diff', '--name-only', '-z', task.base, '--']).split('\0').filter(Boolean),
  );
  for (const file of execFileText(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean))
    changed.add(file);
  const required = new Set([
    'install',
    'pr',
    'image',
    'webImage',
    ...task.criteria.flatMap((ac) => ac.gates),
  ]);
  for (const file of changed) {
    if (
      /(^|\/)Dockerfile$|^\.dockerignore$|^infra\/compose\/|^(?:apps\/(?:backend|web)\/)?package.json$|^pnpm-lock.yaml$/.test(
        file,
      )
    )
      ['image', 'webImage', 'docker'].forEach((g) => required.add(g));
    if (/^infra\/(helm|kubernetes)\/|^scripts\/kubernetes/.test(file)) required.add('kubernetes');
    if (/^infra\/kafka\/|^docs\/contracts\/kafka-topology.json$|^scripts\/kafka-gate/.test(file))
      required.add('kafka');
    if (/^infra\/registry\/|^scripts\/registry\/|^docs\/contracts\/events\//.test(file))
      required.add('registry');
  }
  return Object.keys(gates)
    .filter((g) => required.has(g))
    .map((id) => ({ id, args: ['run', ...gates[id]] }));
}
function execFileText(root, args) {
  return require('node:child_process').execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

module.exports = { readTask, plan, localFile };
