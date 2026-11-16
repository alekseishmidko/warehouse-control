/** @file Настоящие disposable Git/child processes: content freshness, required gates, failure/locks и log integrity. */
const { test } = require('node:test');
const a = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { snapshot } = require('./snapshot.cjs');
const { plan, readTask } = require('./policy.cjs');
const cli = path.resolve(__dirname, 'cli.cjs');
function fixture(script = 'node -e "console.log(123)"') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-harness-'));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  fs.writeFileSync(path.join(root, '.gitignore'), 'artifacts/\n.env\n');
  fs.writeFileSync(path.join(root, 'input.txt'), 'v1');
  fs.writeFileSync(path.join(root, 'spec.cjs'), '// fixture evidence reference\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10.18.3', scripts: { 'check:pr': script } }),
  );
  git('init');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const task = {
    version: 1,
    id: 'test-task',
    issuedBy: 'test operator',
    request: 'Verify runner control protocol',
    base: git('rev-parse', 'HEAD'),
    criteria: [
      {
        id: 'AC-1',
        statement: 'Gate process exits successfully',
        tests: ['spec.cjs#fixture'],
        gates: ['pr'],
      },
    ],
  };
  fs.writeFileSync(path.join(root, 'task.json'), JSON.stringify(task));
  return {
    root,
    task,
    git,
    invoke(mode, extraEnv = {}) {
      return spawnSync(process.execPath, [cli, mode, 'task.json'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, ...extraEnv },
      });
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
test('snapshot covers dirty/untracked/deletion/symlink/env but ignores build artifacts', () => {
  const f = fixture();
  try {
    const initial = snapshot(f.root).digest;
    fs.mkdirSync(path.join(f.root, 'artifacts'));
    fs.writeFileSync(path.join(f.root, 'artifacts', 'output'), 'ignored');
    a.equal(snapshot(f.root).digest, initial);
    for (const name of ['input.txt', 'new.txt', '.env']) {
      fs.writeFileSync(path.join(f.root, name), 'changed');
      a.notEqual(snapshot(f.root).digest, initial);
      if (name === 'input.txt') fs.writeFileSync(path.join(f.root, name), 'v1');
      else fs.unlinkSync(path.join(f.root, name));
    }
    fs.unlinkSync(path.join(f.root, 'input.txt'));
    a.notEqual(snapshot(f.root).digest, initial);
    fs.symlinkSync('/missing/target', path.join(f.root, 'input.txt'));
    a.notEqual(snapshot(f.root).digest, initial);
  } finally {
    f.close();
  }
});
test('task cannot disable mandatory gates or omit AC references', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, 'infra', 'kafka'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'infra', 'kafka', 'dev.yaml'), '# fixture');
    a.deepEqual(
      plan(f.root, f.task, snapshot(f.root)).map((g) => g.id),
      ['pr', 'kafka'],
    );
    f.task.criteria[0].tests = [];
    fs.writeFileSync(path.join(f.root, 'task.json'), JSON.stringify(f.task));
    a.throws(() => readTask(f.root, 'task.json'));
  } finally {
    f.close();
  }
});
test('CLI run/ready bind success to content and exact logs; stale/failed rerun cannot reuse pass', () => {
  const f = fixture();
  try {
    a.notEqual(f.invoke('ready').status, 0);
    const run = f.invoke('run');
    a.equal(run.status, 0, run.stderr + run.stdout);
    a.equal(f.invoke('ready').status, 0);
    // Consumer-only настройки также меняют runtime поведение и должны обесценивать evidence.
    a.notEqual(f.invoke('ready', { CONSUMER_START: 'changed-fixture-setting' }).status, 0);
    const state = JSON.parse(
      fs.readFileSync(path.join(f.root, 'artifacts/harness/test-task/latest.json')),
    );
    const log = path.join(f.root, 'artifacts/harness/test-task', state.run, 'pr.log');
    const bytes = fs.readFileSync(log);
    fs.appendFileSync(log, 'tamper');
    a.notEqual(f.invoke('ready').status, 0);
    fs.writeFileSync(log, bytes);
    fs.writeFileSync(path.join(f.root, 'input.txt'), 'v2');
    a.notEqual(f.invoke('ready').status, 0);
    fs.mkdirSync(path.join(f.root, 'artifacts/harness/.lock'));
    a.notEqual(f.invoke('run').status, 0);
    fs.rmSync(path.join(f.root, 'artifacts/harness/.lock'), { recursive: true });
  } finally {
    f.close();
  }
  const failed = fixture('node -e "process.exit(7)"');
  try {
    a.notEqual(failed.invoke('run').status, 0);
    a.notEqual(failed.invoke('ready').status, 0);
  } finally {
    failed.close();
  }
});
test('input write and revert during gate invalidates evidence', () => {
  const f = fixture(
    "node -e \"const f=require('node:fs');f.writeFileSync('input.txt','v2');setTimeout(()=>f.writeFileSync('input.txt','v1'),100)\"",
  );
  try {
    const result = f.invoke('run');
    a.notEqual(result.status, 0, result.stdout);
    const state = JSON.parse(
      fs.readFileSync(path.join(f.root, 'artifacts/harness/test-task/latest.json')),
    );
    a.equal(state.status, 'stale');
    a.notEqual(f.invoke('ready').status, 0);
  } finally {
    f.close();
  }
});

/** Timeout останавливает настоящий process group; никакого passWithNoTests/fallback runner не использует. */
test('timeout is a failed result, never a successful command', async () => {
  const f = fixture('node -e "setInterval(()=>{},1000)"');
  try {
    const { execute } = require('./cli.cjs');
    const result = await execute(
      f.root,
      { id: 'pr', args: ['run', 'check:pr'] },
      path.join(f.root, 'timeout.log'),
      100,
    );
    a.equal(result.timedOut, true);
    a.notEqual(result.code, 0);
  } finally {
    f.close();
  }
});

test('malformed task JSON does not echo input into CLI errors', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'task.json'), '{HARNESS_PRIVATE_CANARY');
    const result = f.invoke('plan');
    a.notEqual(result.status, 0);
    a.ok(!(result.stderr + result.stdout).includes('HARNESS_PRIVATE_CANARY'));
  } finally {
    f.close();
  }
});
