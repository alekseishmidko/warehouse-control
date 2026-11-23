/** @file WMS-603: отдельное проверяемое registry pull предусловие до migration Job; owner DB Secret не нужен. */
const assert = require('node:assert/strict');
const { assertPulledConfig } = require('../image-release/pull-kind.cjs');
const { nodeVersion } = require('../image-release/runtime.cjs');
const accepted = require('../../docs/reports/wms-602-pull-evidence.json');
/** Новый kind реально читает registry по digest; expected config берётся из accepted source evidence WMS-602. */
function verifyRegistryAccess(session) {
  const proof = [];
  for (const app of ['backend', 'web']) {
    const expected = accepted.images.find((entry) => entry.app === app);
    const reference = require('../image-release/pull-kind.cjs').parseReleaseRef(
      expected.reference,
      'alekseishmidko/warehouse-control',
      app,
    );
    const name = 'registry-' + app;
    const code = `const a=require('node:assert/strict');a.equal(process.arch,'arm64');a.equal(process.version,${JSON.stringify(nodeVersion)});a.equal(process.getuid(),1000);console.log('checked-runtime')`;
    session.apply({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name },
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          seccompProfile: { type: 'RuntimeDefault' },
        },
        containers: [
          {
            name: 'pull',
            image: reference,
            imagePullPolicy: 'Always',
            command: ['node', '-e', code],
            securityContext: {
              readOnlyRootFilesystem: true,
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
          },
        ],
      },
    });
    session.k([
      'wait',
      'pod/' + name,
      '--for=jsonpath={.status.phase}=Succeeded',
      '--timeout=300s',
    ]);
    const cri = JSON.parse(
      session.run('docker', [
        'exec',
        session.cluster + '-control-plane',
        'crictl',
        'inspecti',
        '-o',
        'json',
        reference,
      ]),
    ).status;
    assertPulledConfig(cri, reference, expected.checkedConfigId);
    assert.equal(session.k(['logs', name]).trim(), 'checked-runtime');
    proof.push({ app, reference, configId: cri.id, runtimeVerified: true });
    session.k(['delete', 'pod', name, '--wait=true']);
  }
  return proof;
}
module.exports = { verifyRegistryAccess };
