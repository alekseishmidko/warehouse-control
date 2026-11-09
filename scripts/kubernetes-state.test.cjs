/** @file Regression AC-R04-04: polling видит и Running, и уже завершённую попытку миграции. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasMigrationAttempt } = require('./kubernetes-state.cjs');
/** Минимальный PodList моделирует наблюдаемый Kubernetes status, не тайминги scheduler. */
function pods(state) {
  return { items: [{ status: { containerStatuses: [{ state }] } }] };
}
test('AC-R04-04: a fast failed migration is observed after Running was missed', () => {
  assert.equal(hasMigrationAttempt(pods({ terminated: { exitCode: 1 } })), true);
});
test('AC-R04-04: pending does not count as a started migration', () => {
  assert.equal(hasMigrationAttempt({ items: [] }), false);
  assert.equal(hasMigrationAttempt({ items: [{ status: {} }] }), false);
  assert.equal(hasMigrationAttempt(pods({ waiting: { reason: 'ContainerCreating' } })), false);
  assert.equal(hasMigrationAttempt(pods({ running: { startedAt: '2026-11-09T00:00:00Z' } })), true);
  assert.equal(hasMigrationAttempt(pods({ terminated: { exitCode: 0 } })), true);
});

/** Один ready старый Pod удовлетворял Helm wait, пока новая revision ещё запускалась. */
test('AC-R04-05: old live Pod and starting new Pod do not complete auth rollout', () => {
  const { hasReadyApiRevision } = require('./kubernetes-state.cjs');
  const deployment = {
    metadata: { generation: 2 },
    spec: { replicas: 1 },
    status: {
      observedGeneration: 2,
      updatedReplicas: 1,
      availableReplicas: 1,
      replicas: 2,
    },
  };
  const pod = (ready) => ({
    metadata: {},
    status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  });
  assert.equal(hasReadyApiRevision(deployment, { items: [pod(true), pod(false)] }), false);
});

/** Завершение rollout требует текущую generation и фактические Ready Pods, не только число ready replicas. */
test('AC-R04-05: only the available current revision without old Pods permits login', () => {
  const { hasReadyApiRevision } = require('./kubernetes-state.cjs');
  const deployment = {
    metadata: { generation: 2 },
    spec: { replicas: 1 },
    status: {
      observedGeneration: 2,
      updatedReplicas: 1,
      availableReplicas: 1,
      replicas: 1,
    },
  };
  const pod = { metadata: {}, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
  assert.equal(hasReadyApiRevision(deployment, { items: [pod] }), true);
  assert.equal(hasReadyApiRevision(deployment, { items: [] }), false);
  assert.equal(
    hasReadyApiRevision(deployment, {
      items: [{ ...pod, metadata: { deletionTimestamp: '2026-11-09T00:00:00Z' } }],
    }),
    false,
  );
  assert.equal(
    hasReadyApiRevision(deployment, { items: [{ ...pod, status: { conditions: [] } }] }),
    false,
  );
  assert.equal(
    hasReadyApiRevision(
      { ...deployment, status: { ...deployment.status, observedGeneration: 1 } },
      { items: [pod] },
    ),
    false,
  );
  assert.equal(
    hasReadyApiRevision(
      { ...deployment, status: { ...deployment.status, updatedReplicas: 0 } },
      { items: [pod] },
    ),
    false,
  );
});
