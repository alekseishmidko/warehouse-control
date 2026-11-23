/** @file WMS-603: установка закреплённого Argo Core в собственном disposable cluster; публичный API/UI не создаётся. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const yaml = createRequire(require.resolve('@asyncapi/parser'))('js-yaml');
const lock = require('../../infra/gitops/toolchain.json');
const { hash } = require('./tools.cjs');
/** Подменяет только проверенные source image refs; неизвестный image не получает доверие по tag. */
function pinnedCore(text) {
  if (hash(Buffer.from(text)) !== lock.core.sha256)
    throw Error('Argo Core source checksum mismatch');
  const documents = yaml.loadAll(text).filter(Boolean);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'image' && typeof item === 'string') {
        if (!lock.core.images[item]) throw Error('Unreviewed Argo image');
        value[key] = lock.core.images[item];
      } else visit(item);
    }
  }
  documents.forEach(visit);
  return documents;
}
/** Применяет vendor CRDs server-side; ожидание фактического rollout обязательно до Application. */
async function installCore(session, tools) {
  const { k, apply } = session;
  const documents = pinnedCore(fs.readFileSync(tools.core, 'utf8'));
  const imported = {};
  // Загрузка является setup, а не readiness приложения. Registry digest → Docker config → CRI config проверяет общий helper.
  for (const [index, reference] of Object.values(lock.core.images).entries()) {
    session.run('docker', ['pull', reference]);
    const id = JSON.parse(session.run('docker', ['image', 'inspect', reference]))[0].Id;
    const tag = 'warehouse-vendor:' + session.cluster + '-' + index;
    session.run('docker', ['tag', id, tag]);
    session.ownedImages.push(tag);
    const digest = require('./import.cjs').importCheckedImage(session, tag, 'vendor-' + index);
    imported[reference] = {
      source: reference,
      dockerImageId: id,
      checkedConfigId: JSON.parse(
        session.run('docker', [
          'exec',
          session.cluster + '-control-plane',
          'crictl',
          'inspecti',
          'docker.io/library/' + tag,
        ]),
      ).status.id,
      local: 'warehouse-vendor@' + digest,
    };
  }
  function useImported(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.image === 'string') {
      assert.ok(imported[value.image], 'Pinned Core image must have verified import');
      value.image = imported[value.image].local;
      value.imagePullPolicy = 'Never';
    }
    for (const child of Object.values(value)) useImported(child);
  }
  documents.forEach(useImported);
  k(
    ['apply', '--server-side', '-f', '-'],
    JSON.stringify({ apiVersion: 'v1', kind: 'List', items: documents }),
    'argocd',
  );
  for (const [kind, name] of [
    ['deployment', 'argocd-redis'],
    ['deployment', 'argocd-repo-server'],
    ['statefulset', 'argocd-application-controller'],
  ]) {
    console.log('WAIT Argo ' + kind + '/' + name);
    k(['rollout', 'status', kind + '/' + name, '--timeout=180s'], undefined, 'argocd');
  }
  // Core не создаёт argocd-server; rehearsal управляет Application через private Kubernetes credentials.
  const services = JSON.parse(k(['get', 'services', '-o', 'json'], undefined, 'argocd')).items;
  assert.ok(
    services.every((s) => s.metadata.name !== 'argocd-server' && s.spec.type === 'ClusterIP'),
  );
  apply(
    {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: { name: 'warehouse', namespace: 'argocd' },
      spec: {
        sourceRepos: ['http://git-source.warehouse-dev.svc.cluster.local:8080/repo.git'],
        destinations: [{ namespace: session.namespace, server: 'https://kubernetes.default.svc' }],
        clusterResourceWhitelist: [],
        namespaceResourceWhitelist: [
          { group: '', kind: 'ConfigMap' },
          { group: '', kind: 'ServiceAccount' },
          { group: '', kind: 'Service' },
          { group: 'apps', kind: 'Deployment' },
          { group: 'batch', kind: 'Job' },
        ],
        orphanedResources: { warn: true },
      },
    },
    'argocd',
  );
  return {
    version: lock.versions.argocd,
    imageImports: Object.values(imported),
    publicServerAbsent: true,
    namespace: session.namespace,
    sourceRepoRestricted: true,
  };
}
module.exports = { pinnedCore, installCore };
