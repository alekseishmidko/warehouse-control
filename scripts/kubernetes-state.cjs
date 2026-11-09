/** @file Проверки Kubernetes status: migration attempt и завершение API revision перед auth. */
/**
 * Принимает PodList migration Job. Быстрая ошибка соединения с БД может завершить
 * контейнер между двумя чтениями: Running не является обязательным наблюдаемым состоянием.
 * Это только milestone попытки, а не успех миграции; install/result и отсутствие workloads
 * проверяет caller. Pending не доказывает начало выполнения контейнера.
 */
function hasMigrationAttempt(pods) {
  return pods.items.some((p) =>
    p.status.containerStatuses?.some((c) => c.state.running || c.state.terminated),
  );
}
module.exports = { hasMigrationAttempt };

/** Готовность новой API revision проверяется до auth POST с новым AUTH_ORIGIN. */
function hasReadyApiRevision(deployment, pods) {
  const desired = deployment.spec.replicas ?? 1;
  const status = deployment.status;
  // Ready старого ReplicaSet не подтверждает применение нового AUTH_ORIGIN. Проверяем
  // generation и весь rollout, затем физическое отсутствие старых/terminating upstream.
  return (
    desired > 0 &&
    status.observedGeneration >= deployment.metadata.generation &&
    status.updatedReplicas === desired &&
    status.availableReplicas === desired &&
    status.replicas === desired &&
    pods.items.length === desired &&
    pods.items.every(
      (p) =>
        !p.metadata.deletionTimestamp &&
        p.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'),
    )
  );
}
module.exports.hasReadyApiRevision = hasReadyApiRevision;
