/** @file Local runner: plan/run/ready с content-bound evidence и checkout lock; не заменяет внешний CI trust boundary. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const { snapshot, watchInputs, hash, git } = require('./snapshot.cjs');
const { readTask, plan } = require('./policy.cjs');
/** Только fingerprints окружения: credentials из env не копируются в evidence. */
function environment() {
  const relevant = Object.entries(process.env)
    .filter(([key]) =>
      /^(PATH$|NODE_|TSESTREE_|CI$|DOCKER_|WMS_|LOG_|OTEL_|AUTH_|DATABASE_|POSTGRES_|PUBLISHER_|CONSUMER_)/.test(
        key,
      ),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    node: process.version,
    pnpm: execFileSync('pnpm', ['--version'], {
      encoding: 'utf8',
      env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0' },
    }).trim(),
    settings: hash(JSON.stringify(relevant)),
  };
}
/** State/log directories не могут перенаправить записи через заранее созданный symlink. */
function directory(root, relative, create = true) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current) && create) fs.mkdirSync(current, { mode: 0o700 });
    if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink())
      throw Error('Unsafe artifact directory');
  }
  return current;
}
/** Команда запускается без shell. Timeout/signal помечают failure, никогда не successful skip. */
function execute(root, gate, log, timeoutMs) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'wx', 0o600);
    const started = Date.now();
    let timedOut = false,
      interrupted = false,
      settled = false;
    const child = spawn('pnpm', gate.args, {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    let killTimer;
    let terminating = false;
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 10000);
    };
    const signal = () => {
      interrupted = true;
      terminate();
    };
    process.once('SIGTERM', signal);
    process.once('SIGINT', signal);
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const finish = (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('SIGTERM', signal);
      process.off('SIGINT', signal);
      const done = () => {
        fs.closeSync(fd);
        resolve({
          id: gate.id,
          args: gate.args,
          code,
          signal: exitSignal ?? null,
          timedOut,
          interrupted,
          durationMs: Date.now() - started,
          logHash: hash(fs.readFileSync(log)),
        });
      };
      // Даже ранний exit parent после SIGTERM не отменяет bounded kill его process group.
      if (killTimer) setTimeout(done, 10100);
      else done();
    };
    child.once('error', () => finish(null, 'SPAWN_FAILED'));
    child.once('close', finish);
  });
}
async function main() {
  const [mode, file, ...rest] = process.argv.slice(2);
  if (rest.length || !['plan', 'run', 'ready'].includes(mode) || !file)
    throw Error('Usage: harness plan|run|ready <task.json>');
  const root = fs.realpathSync(git(process.cwd(), ['rev-parse', '--show-toplevel']));
  const task = readTask(root, file);
  const inputs = snapshot(root);
  const required = plan(root, task, inputs);
  const env = environment();
  if (mode === 'plan') {
    console.log(
      JSON.stringify(
        {
          task: task.id,
          base: task.base,
          snapshot: inputs.digest,
          criteria: task.criteria,
          gates: required,
        },
        null,
        2,
      ),
    );
    return;
  }
  const storage = directory(root, 'artifacts/harness', mode === 'run');
  const taskDir = directory(root, 'artifacts/harness/' + task.id, mode === 'run');
  const latest = path.join(taskDir, 'latest.json');
  if (mode === 'ready') {
    if (fs.existsSync(path.join(storage, '.lock')))
      throw Error('NOT READY: checkout run active or stale lock');
    const state = JSON.parse(fs.readFileSync(latest, 'utf8'));
    if (
      state.version !== 1 ||
      state.status !== 'passed' ||
      state.task !== task.id ||
      state.snapshot !== inputs.digest ||
      JSON.stringify(state.environment) !== JSON.stringify(env) ||
      JSON.stringify(state.plan) !== JSON.stringify(required) ||
      !/^[-a-f0-9]{36}$/.test(state.run)
    )
      throw Error('NOT READY: missing, stale or unsuccessful evidence');
    if (!Array.isArray(state.results) || state.results.length !== required.length)
      throw Error('NOT READY: incomplete gates');
    for (let i = 0; i < required.length; i++) {
      const result = state.results[i];
      const verifiedDir = directory(root, 'artifacts/harness/' + task.id + '/' + state.run, false);
      const log = path.join(verifiedDir, required[i].id + '.log');
      if (
        result.id !== required[i].id ||
        JSON.stringify(result.args) !== JSON.stringify(required[i].args) ||
        result.code !== 0 ||
        result.signal ||
        result.timedOut ||
        result.interrupted ||
        fs.lstatSync(log).isSymbolicLink() ||
        result.logHash !== hash(fs.readFileSync(log))
      )
        throw Error('NOT READY: gate/log invalid');
    }
    console.log(
      'TECHNICALLY READY ' +
        task.id +
        ' ' +
        inputs.digest +
        '; user acceptance/review remain explicit',
    );
    return;
  }
  const lock = path.join(storage, '.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    fs.writeFileSync(
      path.join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, task: task.id }),
      { mode: 0o600, flag: 'wx' },
    );
    const run = randomUUID();
    const runDir = directory(root, 'artifacts/harness/' + task.id + '/' + run);
    const state = {
      version: 1,
      task: task.id,
      run,
      status: 'running',
      snapshot: inputs.digest,
      files: inputs.files,
      environment: env,
      plan: required,
      results: [],
      startedAt: new Date().toISOString(),
    };
    await writeAtomicJson(latest, state);
    for (const gate of required) {
      console.log('RUN ' + gate.id);
      const watch = watchInputs(root, inputs, { installingDependencies: gate.id === 'install' });
      let result;
      try {
        result = await execute(root, gate, path.join(runDir, gate.id + '.log'), 1800000);
      } finally {
        watch.close();
      }
      state.results.push(result);
      if (watch.failed()) {
        state.status = 'blocked';
        await writeAtomicJson(latest, state);
        break;
      }
      state.status =
        watch.changed() || snapshot(root).digest !== inputs.digest
          ? 'stale'
          : result.code === 0 && !result.signal && !result.timedOut && !result.interrupted
            ? 'running'
            : 'failed';
      await writeAtomicJson(latest, state);
      if (state.status !== 'running') break;
    }
    if (state.status === 'running') state.status = 'passed';
    state.finishedAt = new Date().toISOString();
    await writeAtomicJson(latest, state);
    console.log(
      state.status.toUpperCase() +
        ' ' +
        task.id +
        '; evidence: artifacts/harness/' +
        task.id +
        '/latest.json',
    );
    if (state.status !== 'passed') process.exitCode = 1;
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
}
if (require.main === module)
  main().catch((error) => {
    // JSON parser/OS/tool errors могут содержать excerpt input или paths. Не отражаем их целиком.
    const controlled =
      typeof error.message === 'string' &&
      /^(Usage:|Expected |Invalid |Task |Acceptance |Criterion |Unknown |File outside|Harness state|Unsafe artifact|NOT READY:)/.test(
        error.message,
      );
    console.error(
      'Harness refused: ' +
        (error.code === 'EEXIST'
          ? 'checkout is locked; inspect artifacts/harness/.lock/owner.json'
          : controlled
            ? error.message
            : 'operation failed; verify task JSON, source files and required tools'),
    );
    process.exitCode = 1;
  });
module.exports = { execute, environment };
