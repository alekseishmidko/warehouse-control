/** @file WMS-602: opt-in registry pull по digest в новом kind ARM64; не устанавливает WMS/БД.
 * Только согласованный workflow передаёт short-lived packages:read token. Secret и kubeconfig не публикуются. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const { nodeVersion } = require('./runtime.cjs');
/** Принимает только ожидаемый GHCR repository/app с immutable digest; tag/shell/чужой repo запрещены. */
function parseReleaseRef(value, repository, app) {
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(repository) || !['backend', 'web'].includes(app))
    throw Error('Invalid release scope');
  const prefix = `ghcr.io/${repository}/${app}@sha256:`;
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/.test(value.slice(prefix.length))
  )
    throw Error('Expected immutable GHCR release reference');
  return value;
}
/** Запускает fixed CLI argv без shell. Secret input никогда не включается в diagnostic error. */
function run(binary, args, input, secret = false, timeout = 150000) {
  try {
    return execFileSync(binary, args, {
      input,
      encoding: 'utf8',
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    if (secret) throw Error('Registry pull Secret creation failed');
    throw Error(`${binary} failed: ${error.stderr?.toString().slice(-1800) || error.message}`);
  }
}
/** Создаёт только UUID-owned cluster/namespace; finally удаляет cluster, Secret и private kubeconfig.
 * RepoDigest сверяется с CRI metadata, так как Pod.imageID может обозначать config либо platform manifest.
 * Вывод содержит commit/run/reference/imageID/runtime facts, но не auth data. Cleanup error запрещает passed. */
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ARCH !== 'ARM64')
    throw Error('Opt-in ARM64 Actions pull job required');
  const repository = (process.env.GITHUB_REPOSITORY || '').toLowerCase();
  const refs = Object.fromEntries(
    ['backend', 'web'].map((app) => [
      app,
      parseReleaseRef(process.env[`RELEASE_${app.toUpperCase()}_REF`], repository, app),
    ]),
  );
  const configs = Object.fromEntries(
    ['backend', 'web'].map((app) => {
      const value = process.env[`RELEASE_${app.toUpperCase()}_CONFIG`];
      if (!/^sha256:[a-f0-9]{64}$/.test(value || '')) throw Error('Checked config ID required');
      return [app, value];
    }),
  );
  const token = process.env.GITHUB_TOKEN;
  const actor = process.env.GITHUB_ACTOR;
  if (!token || !actor || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || ''))
    throw Error('Workflow identity and read:packages credential required');
  const kind = process.env.WMS_KIND || 'kind';
  const kubectl = process.env.WMS_KUBECTL || 'kubectl';
  const name = 'wms602-pull-' + randomUUID().slice(0, 8);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const config = path.join(directory, 'kubeconfig');
  const k = (args, input, secret = false) =>
    run(
      kubectl,
      ['--kubeconfig', config, '--context', 'kind-' + name, '-n', 'image-pull', ...args],
      input,
      secret,
    );
  const evidence = {
    status: 'running',
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    architecture: 'arm64',
    cluster: name,
    images: [],
  };
  let attempted = false;
  let failure;
  try {
    assert.ok(!run(kind, ['get', 'clusters']).split(/\r?\n/).includes(name));
    attempted = true;
    run(
      kind,
      [
        'create',
        'cluster',
        '--name',
        name,
        '--kubeconfig',
        config,
        '--image',
        'kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5',
        '--wait',
        '180s',
      ],
      undefined,
      false,
      240000,
    );
    fs.chmodSync(config, 0o600);
    const nodes = JSON.parse(k(['get', 'nodes', '-o', 'json'])).items;
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].status.nodeInfo.architecture, 'arm64');
    const cache = JSON.parse(
      run('docker', ['exec', name + '-control-plane', 'crictl', 'images', '-o', 'json']),
    );
    assert.ok(
      !(cache.images || []).some((i) =>
        [...(i.repoTags || []), ...(i.repoDigests || [])].some((ref) =>
          ref.startsWith(`ghcr.io/${repository}/`),
        ),
      ),
      'Target must not have release images cached',
    );
    evidence.initialReleaseCacheEmpty = true;
    k(['create', 'namespace', 'image-pull']);
    const auth = Buffer.from(
      JSON.stringify({
        auths: {
          'ghcr.io': {
            auth: Buffer.from(actor + ':' + token).toString('base64'),
          },
        },
      }),
    ).toString('base64');
    k(
      ['create', '-f', '-'],
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'registry-pull', namespace: 'image-pull' },
        type: 'kubernetes.io/dockerconfigjson',
        data: { '.dockerconfigjson': auth },
      }),
      true,
    );
    for (const [app, reference] of Object.entries(refs)) {
      const code = `const a=require('node:assert/strict');a.equal(process.arch,'arm64');a.equal(process.version,${JSON.stringify(nodeVersion)});a.equal(process.getuid(),1000);console.log(JSON.stringify({version:process.version,architecture:process.arch,uid:process.getuid()}))`;
      k(
        ['create', '-f', '-'],
        JSON.stringify({
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: { name: app, namespace: 'image-pull' },
          spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            imagePullSecrets: [{ name: 'registry-pull' }],
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [
              {
                name: app,
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
        }),
      );
      k(['wait', 'pod/' + app, '--for=jsonpath={.status.phase}=Succeeded', '--timeout=120s']);
      const pod = JSON.parse(k(['get', 'pod', app, '-o', 'json']));
      const state = pod.status.containerStatuses[0];
      assert.equal(state.state.terminated.exitCode, 0);
      const image = JSON.parse(
        run('docker', [
          'exec',
          name + '-control-plane',
          'crictl',
          'inspecti',
          '-o',
          'json',
          reference,
        ]),
      ).status;
      assert.ok(image.repoDigests.includes(reference), 'CRI must retain requested registry digest');
      assert.equal(
        image.id,
        configs[app],
        'Pulled config must equal final scanned/exported config',
      );
      assert.ok(
        [reference, image.id, ...image.repoDigests].some(
          (id) => state.imageID === id || state.imageID.endsWith('//' + id),
        ),
        'Pod imageID must resolve to pulled CRI image',
      );
      const runtime = JSON.parse(k(['logs', app]).trim());
      evidence.images.push({
        app,
        reference,
        imageID: state.imageID,
        criImageID: image.id,
        checkedConfigId: configs[app],
        runtime,
      });
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    failure = error;
  } finally {
    try {
      if (attempted)
        run(
          kind,
          ['delete', 'cluster', '--name', name, '--kubeconfig', config],
          undefined,
          false,
          120000,
        );
      evidence.cleanup = 'passed';
    } catch (error) {
      evidence.cleanup = 'failed';
      evidence.status = 'failed';
      failure ||= error;
    }
    fs.rmSync(directory, { recursive: true, force: true });
    await writeAtomicJson(path.resolve('artifacts/release-pull/evidence.json'), evidence);
  }
  if (failure) throw failure;
  console.log('PASS fresh kind ARM64 registry pull, Node/uid smoke and cleanup');
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { parseReleaseRef };
