/** @file WMS-604: полная реальная release/recovery репетиция после GitOps bootstrap; только новый synthetic kind. */
const { runRehearsal } = require('./rehearsal.cjs');
const { checkRelease } = require('./release.cjs');
const { verifyTransportRecovery } = require('./transport-proof.cjs');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
/** Kafka и kind используют Docker последовательно, чтобы отдельные proof не конкурировали за RAM/compiled test output. */
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-release-preflight-'));
  const file = path.resolve('artifacts/release-drill/evidence.json');
  const startedAt = new Date().toISOString();
  await writeAtomicJson(file, { status: 'running', stage: 'transport-preflight', startedAt });
  try {
    console.log('RUN external event recovery policy (real PostgreSQL/Kafka)');
    const transportProof = verifyTransportRecovery(directory);
    await runRehearsal('release-drill', async (state) => {
      state.evidence.fullStartedAt = startedAt;
      state.transportProof = transportProof;
      await checkRelease(state);
    });
  } catch (error) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    await writeAtomicJson(file, {
      ...previous,
      status: 'failed',
      finishedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error('Release drill failed: ' + error.message);
    process.exitCode = 1;
  });
