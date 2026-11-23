/** @file WMS-603: Git revision → Argo sync; только namespace приложения и известный local Git source. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { until } = require('./session.cjs');
const { repositoryURL } = require('./source.cjs');
/** Единственный desired source — chart/values из Git. Параметры image/Secret через live overrides не передаются. */
function application(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Exact Git revision required');
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name: 'warehouse', namespace: 'argocd' },
    spec: {
      project: 'warehouse',
      source: {
        repoURL: repositoryURL,
        targetRevision: commit,
        path: 'infra/helm/warehouse',
        helm: { releaseName: 'warehouse', valueFiles: ['../../../environments/local/values.yaml'] },
      },
      destination: { server: 'https://kubernetes.default.svc', namespace: 'warehouse-dev' },
      // Sync остаётся явным действием оператора; live drift не превращается в новый desired state.
      syncPolicy: { syncOptions: ['PruneLast=true'] },
    },
  };
}
/** Запускает реальный controller sync и возвращает его revision/phase; failed Job не скрывается CLI fallback. */
async function syncApplication(session, commit, expected = 'Succeeded') {
  const operationId = randomUUID();
  session.apply(application(commit), 'argocd');
  session.k(
    ['annotate', 'application', 'warehouse', 'argocd.argoproj.io/refresh=hard', '--overwrite'],
    undefined,
    'argocd',
  );
  const comparison = await until(
    () =>
      JSON.parse(session.k(['get', 'application', 'warehouse', '-o', 'json'], undefined, 'argocd')),
    (value) =>
      value.status?.sync?.revision === commit &&
      ['Synced', 'OutOfSync'].includes(value.status.sync.status) &&
      !(value.status.conditions || []).some((c) =>
        ['ComparisonError', 'InvalidSpecError'].includes(c.type),
      ),
  );
  session.k(
    [
      'patch',
      'application',
      'warehouse',
      '--type=merge',
      '-p',
      JSON.stringify({
        operation: {
          info: [{ name: 'rehearsal', value: operationId }],
          sync: { revision: commit, prune: false, syncStrategy: { hook: {} } },
        },
      }),
    ],
    undefined,
    'argocd',
  );
  const app = await until(
    () =>
      JSON.parse(session.k(['get', 'application', 'warehouse', '-o', 'json'], undefined, 'argocd')),
    (value) =>
      value.status?.operationState?.operation?.info?.some(
        (item) => item.name === 'rehearsal' && item.value === operationId,
      ) &&
      value.status?.operationState?.syncResult?.revision === commit &&
      ['Succeeded', 'Failed', 'Error'].includes(value.status.operationState.phase),
    240000,
  );
  if (app.status.operationState.phase !== expected)
    throw Error(
      'Argo sync ' +
        app.status.operationState.phase +
        ': ' +
        String(
          app.status.operationState.message || JSON.stringify(app.status.conditions || []),
        ).slice(0, 1800),
    );
  if (expected === 'Succeeded') {
    await until(
      () =>
        JSON.parse(
          session.k(['get', 'application', 'warehouse', '-o', 'json'], undefined, 'argocd'),
        ),
      (value) => value.status?.sync?.revision === commit && value.status?.sync?.status === 'Synced',
    );
    session.k(['rollout', 'status', 'deployment/warehouse-api', '--timeout=180s']);
    session.k(['rollout', 'status', 'deployment/warehouse-worker', '--timeout=180s']);
    session.k(['rollout', 'status', 'deployment/warehouse-web', '--timeout=180s']);
  }
  return {
    revision: commit,
    phase: app.status.operationState.phase,
    comparison: comparison.status.sync.status,
  };
}
/** Доказывает live drift через Argo OutOfSync; явный sync возвращает Git replica count. */
async function checkDrift(session, commit) {
  session.k(['scale', 'deployment/warehouse-api', '--replicas=2']);
  session.k(
    ['annotate', 'application', 'warehouse', 'argocd.argoproj.io/refresh=hard', '--overwrite'],
    undefined,
    'argocd',
  );
  await until(
    () =>
      JSON.parse(session.k(['get', 'application', 'warehouse', '-o', 'json'], undefined, 'argocd')),
    (app) => app.status?.sync?.status === 'OutOfSync',
  );
  await syncApplication(session, commit);
  assert.equal(
    JSON.parse(session.k(['get', 'deployment', 'warehouse-api', '-o', 'json'])).spec.replicas,
    1,
  );
  return { outOfSyncObserved: true, desiredReplicasRestored: true, revision: commit };
}
module.exports = { application, syncApplication, checkDrift };
