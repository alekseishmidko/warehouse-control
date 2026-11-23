/** @file WMS-603/604: изолированный kind и bounded CLI adapters без вывода credentials. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
/** Ждёт наблюдаемое состояние с deadline; ошибки чтения не заменяются успешным fallback. */
async function until(read, accept, timeout = 180000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw Error('GitOps observation deadline exceeded');
}
/** Создаёт adapters только своего cluster/context. run не печатает stderr/argv: они могут содержать секрет. */
function createSession(tools) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-gitops-'));
  const cluster = 'wms-gitops-' + randomUUID().replaceAll('-', '');
  const namespace = 'warehouse-dev';
  const kubeconfig = path.join(directory, 'kubeconfig');
  const context = 'kind-' + cluster;
  const kind = process.env.WMS_KIND || tools.kind;
  const kubectl = process.env.WMS_KUBECTL || tools.kubectl;
  const env = { ...process.env, KUBECONFIG: kubeconfig, ARGOCD_NAMESPACE: 'argocd' };
  let attempted = false;
  let cancelled = false;
  let closing = false;
  const ownedImages = [];
  const cancelledBySignal = () => {
    cancelled = true;
  };
  process.on('SIGTERM', cancelledBySignal);
  process.on('SIGINT', cancelledBySignal);
  function run(binary, args, input, encoding = 'utf8', timeout = 300000) {
    if (cancelled && !closing) throw Error('GitOps rehearsal cancelled');
    try {
      return execFileSync(binary, args, {
        input,
        encoding,
        env,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const detail =
        binary === kind ||
        (binary === kubectl && args.includes('rollout') && args.includes('status')) ||
        (binary === 'docker' &&
          args[0] === 'build' &&
          String(args.at(-1)).startsWith(directory + path.sep))
          ? String(error.stderr || '').slice(-1800)
          : 'private diagnostic suppressed';
      throw Error(path.basename(binary) + ' command failed: ' + detail);
    }
  }
  const k = (args, input, ns = namespace) =>
    run(kubectl, ['--kubeconfig', kubeconfig, '--context', context, '-n', ns, ...args], input);
  const apply = (object, ns = namespace) => k(['apply', '-f', '-'], JSON.stringify(object), ns);
  const argo = (args) =>
    run(tools.argocd, [
      ...args,
      '--core',
      '--kube-context',
      context,
      '--config',
      path.join(directory, 'argocd-config'),
    ]);
  const sql = (query, database = 'warehouse') =>
    k(
      [
        'exec',
        '-i',
        'postgres-0',
        '--',
        'psql',
        '-U',
        'warehouse',
        '-d',
        database,
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      query,
    ).trim();
  return {
    directory,
    cluster,
    namespace,
    kubeconfig,
    context,
    env,
    kind,
    kubectl,
    run,
    k,
    apply,
    argo,
    sql,
    ownedImages,
    canI(verb, resource, actor, ns) {
      const result = spawnSync(
        kubectl,
        [
          '--kubeconfig',
          kubeconfig,
          '--context',
          context,
          '-n',
          ns,
          'auth',
          'can-i',
          verb,
          resource,
          '--as=' + actor,
        ],
        { env, encoding: 'utf8', timeout: 30000 },
      );
      if (result.status === 0 && result.stdout.trim() === 'yes') return true;
      if (result.status === 1 && result.stdout.trim() === 'no') return false;
      throw Error('Kubernetes authorization observation failed');
    },
    async start() {
      if (run(kind, ['get', 'clusters']).trim().split(/\r?\n/).includes(cluster))
        throw Error('Owned cluster name collision');
      attempted = true;
      run(kind, [
        'create',
        'cluster',
        '--name',
        cluster,
        '--kubeconfig',
        kubeconfig,
        '--image',
        'kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5',
        '--wait',
        '180s',
      ]);
      fs.chmodSync(kubeconfig, 0o600);
      run(kubectl, [
        '--kubeconfig',
        kubeconfig,
        'config',
        'set-context',
        context,
        '--namespace',
        'argocd',
      ]);
      const node = JSON.parse(k(['get', 'nodes', '-o', 'json'])).items;
      if (node.length !== 1 || node[0].status.nodeInfo.architecture !== 'arm64')
        throw Error('Native ARM64 target required');
      k(['create', 'namespace', namespace]);
      k(['create', 'namespace', 'argocd']);
    },
    async close() {
      closing = true;
      let failure;
      try {
        if (attempted)
          run(kind, ['delete', 'cluster', '--name', cluster, '--kubeconfig', kubeconfig]);
      } catch (error) {
        failure = error;
      }
      try {
        if (
          !ownedImages.every(
            (ref) =>
              ref.startsWith('warehouse-vendor:' + cluster + '-') ||
              ref.startsWith('warehouse-backend:' + cluster + '-') ||
              ref.startsWith('warehouse-web:' + cluster + '-'),
          )
        )
          throw Error('Foreign image cleanup rejected');
        if (ownedImages.length) run('docker', ['image', 'rm', ...ownedImages]);
      } catch (error) {
        failure ||= error;
      } finally {
        process.off('SIGTERM', cancelledBySignal);
        process.off('SIGINT', cancelledBySignal);
        fs.rmSync(directory, { recursive: true, force: true });
      }
      if (failure) throw failure;
    },
  };
}
module.exports = { createSession, until };
