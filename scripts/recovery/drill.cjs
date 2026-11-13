/** @file WMS-404: последовательный drill переиспользует production harness и monitoring gate, не рабочую .env. */
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const root = resolve(__dirname, '../..');
/** Запускает фиксированную команду без shell; raw Jest errors остаются временными, не публикуются в evidence. */
function command(args, cwd = root, env = process.env) {
  return new Promise((yes, no) => {
    const child = spawn('pnpm', args, { cwd, env, stdio: 'inherit' });
    child.once('error', no);
    child.once('exit', (code) => (code === 0 ? yes() : no(new Error('drill command failed'))));
  });
}
/** Сохраняет только имена/status/duration тестов, без DB URL, stack, SQL и HTTP payload. */
async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'wms404-'));
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    sloApproval: 'user-approved-dev-only',
    tests: [],
  };
  try {
    await command(['--filter', '@warehouse/backend', 'test:prepare']);
    const output = join(temp, 'jest.json');
    await command(
      [
        'exec',
        'jest',
        '--selectProjects',
        'integration',
        '--runInBand',
        '--runTestsByPath',
        ...['recovery-drill', 'outbox-recovery', 'worker', 'worker-process'].map(
          (n) => `.test-dist/test/integration/${n}.spec.js`,
        ),
        '--json',
        `--outputFile=${output}`,
      ],
      join(root, 'apps/backend'),
    );
    const results = JSON.parse(await readFile(output, 'utf8'));
    report.tests = results.testResults.flatMap((s) =>
      s.assertionResults.map((t) => ({
        name: t.fullName,
        status: t.status,
        durationMs: t.duration,
      })),
    );
    if (!results.success || report.tests.some((t) => t.status !== 'passed'))
      throw new Error('drill assertions failed');
    await command(['observability:gate'], root, { ...process.env, WMS_RECOVERY_DRILL: '1' });
    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    await mkdir(join(root, 'artifacts/recovery'), { recursive: true });
    await writeAtomicJson(join(root, 'artifacts/recovery/latest.json'), report);
    await writeAtomicJson(join(root, 'docs/reports/wms-404-evidence.json'), report);
    console.log('PASS WMS-404 recovery drill; see docs/reports/wms-404-evidence.json');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('WMS-404 drill failed; accepted evidence not overwritten');
  process.exitCode = 1;
});
