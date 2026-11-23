/** @file WMS-604: свежая реальная Kafka backup/cutover/reverse репетиция до возобновления restored consumers. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { hash } = require('./tools.cjs');
/** Использует принятый ADR-0038 flow, а не придумывает rewind offsets после SQL restore; raw Jest JSON остаётся private. */
function verifyTransportRecovery(directory) {
  const startedAt = new Date().toISOString();
  const file = path.join(directory, 'cutover-jest.json');
  try {
    execFileSync('pnpm', ['cutover:drill', '--json', '--outputFile', file], {
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    fs.mkdirSync('artifacts/release-drill', { recursive: true });
    fs.writeFileSync(
      'artifacts/release-drill/cutover-private.log',
      String(error.stdout || '') + String(error.stderr || ''),
      { mode: 0o600 },
    );
    throw Error('Real Kafka recovery drill failed; diagnostic is private');
  }
  const raw = fs.readFileSync(file);
  const result = JSON.parse(raw);
  assert.equal(result.success, true);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0);
  assert.ok(result.numPassedTests > 0);
  const tests = result.testResults.flatMap((suite) => suite.assertionResults);
  assert.ok(tests.length > 0 && tests.every((test) => test.status === 'passed'));
  assert.ok(tests.some((test) => test.fullName.includes('backup and bidirectional cutover')));
  assert.ok(tests.some((test) => test.fullName.includes('boundary rejects an active claim')));
  return {
    success: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    command: 'pnpm cutover:drill --json --outputFile PRIVATE_FILE',
    tests: tests.map((test) => ({ name: test.fullName, durationMs: test.duration })),
    rawReportSha256: hash(raw),
    eventPolicy:
      'Frozen boundary, restored markers/cursors and retained source validation; no blind broker offset rewind or rollback of published facts',
  };
}
module.exports = { verifyTransportRecovery };
