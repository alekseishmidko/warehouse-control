/** @file WMS-501: собственный kind cluster, Strimzi/mTLS/ACL, log persistence после restart; рабочий kubecontext/.env не используется. */
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const temp = mkdtempSync(join(tmpdir(), 'wms501-'));
const cluster = 'wms501-' + randomUUID().slice(0, 8);
const env = { ...process.env, KUBECONFIG: join(temp, 'config') };
const ns = 'warehouse-kafka';
let phase = 'setup';
/** Метка без argv/config/credentials для диагностики fault. */
function step(value) {
  phase = value;
  console.log('WMS-501 ' + value);
}
const kind = process.env.WMS_KIND || 'kind';
const kubectl = process.env.WMS_KUBECTL || 'kubectl';
const helm = process.env.WMS_HELM || 'helm';
/** Фиксированные argv; credentials остаются внутри Pod. Ошибка не печатает stdin/Secret. */
function run(bin, args, input, timeout = 300000) {
  try {
    return execFileSync(bin, args, {
      env,
      input,
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const codes =
      String(error.stderr ?? '').match(
        /(?:Topic|Group|Cluster)AuthorizationException|[A-Z_]*AUTHORIZATION_FAILED/g,
      ) ?? [];
    throw Error(
      `${bin.split('/').at(-1)} ${phase} failed (timeout or nonzero exit) ${[...new Set(codes)].join(',')}`,
    );
  }
}
const k = (args, input) => run(kubectl, ['--context', 'kind-' + cluster, '-n', ns, ...args], input);
const exec = (command, input) => k(['exec', '-i', 'client', '--', 'sh', '-ec', command], input);
/** Управляет только ресурсами созданного cluster; finally удаляет его даже после fault. */
function main() {
  let ownsCluster = false;
  try {
    // Разрешён только локальный daemon: kubecontext из окружения не должен вызвать внешний deployment.
    const endpoint =
      process.env.DOCKER_HOST ??
      JSON.parse(
        run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']),
      );
    assert.match(endpoint, /^unix:\/\//, 'Kafka gate requires local Unix Docker socket');
    ownsCluster = true;
    console.log('WMS-501 create cluster');
    run(kind, [
      'create',
      'cluster',
      '--name',
      cluster,
      '--image',
      'kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5',
      '--wait',
      '180s',
    ]);
    k(['create', 'namespace', ns]);
    console.log('WMS-501 install Strimzi 1.3.1');
    run(helm, [
      'install',
      'strimzi',
      'strimzi-kafka-operator',
      '--repo',
      'https://strimzi.io/charts/',
      '--version',
      '1.3.1',
      '--namespace',
      ns,
      '--kube-context',
      'kind-' + cluster,
      '--wait',
      '--timeout',
      '300s',
    ]);
    k(['apply', '-f', 'infra/kafka/dev.yaml']);
    k(['wait', 'kafka/warehouse', '--for=condition=Ready', '--timeout=300s']);
    console.log('WMS-501 Kafka Ready; checking topic/users and mTLS');
    for (const resource of [
      'kafkatopic/warehouse.receiving.events',
      'kafkauser/outbox-publisher',
      'kafkauser/inventory-putaway',
    ])
      k(['wait', resource, '--for=condition=Ready', '--timeout=120s']);
    const image = k([
      'get',
      'pod',
      'warehouse-dual-0',
      '-o',
      'jsonpath={.spec.containers[0].image}',
    ]);
    k(
      ['apply', '-f', '-'],
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'client' },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'client',
              image,
              command: [
                'sh',
                '-ec',
                `for user in producer consumer; do printf 'security.protocol=SSL\nssl.truststore.type=PEM\nssl.truststore.location=/ca/ca.crt\nssl.keystore.type=PKCS12\nssl.keystore.location=/%s/user.p12\nssl.keystore.password=%s\n' "$user" "$(cat /$user/user.password)" > /tmp/$user.properties; chmod 600 /tmp/$user.properties; done; sleep 3600`,
              ],
              volumeMounts: [
                { name: 'ca', mountPath: '/ca', readOnly: true },
                { name: 'producer', mountPath: '/producer', readOnly: true },
                { name: 'consumer', mountPath: '/consumer', readOnly: true },
              ],
            },
          ],
          volumes: [
            { name: 'ca', secret: { secretName: 'warehouse-cluster-ca-cert' } },
            { name: 'producer', secret: { secretName: 'outbox-publisher' } },
            { name: 'consumer', secret: { secretName: 'inventory-putaway' } },
          ],
        },
      }),
    );
    k(['wait', 'pod/client', '--for=condition=Ready', '--timeout=180s']);
    const bootstrap = 'warehouse-kafka-bootstrap:9093';
    const key = randomUUID();
    const producer = `/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server ${bootstrap} --topic warehouse.receiving.events --producer.config /tmp/producer.properties --producer-property acks=all --property parse.key=true --property key.separator=:`;
    exec(producer, `${key}:version-1\n${key}:version-2\n`);
    console.log('WMS-501 restart broker; PVC retained');
    const uid = k(['get', 'pod', 'warehouse-dual-0', '-o', 'jsonpath={.metadata.uid}']);
    k(['delete', 'pod', 'warehouse-dual-0', '--wait=true']);
    k(['wait', 'pod/warehouse-dual-0', '--for=create', '--timeout=120s']);
    k(['wait', 'pod/warehouse-dual-0', '--for=condition=Ready', '--timeout=300s']);
    assert.notEqual(k(['get', 'pod', 'warehouse-dual-0', '-o', 'jsonpath={.metadata.uid}']), uid);
    step('read retained records');
    const read = exec(
      `/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server ${bootstrap} --topic warehouse.receiving.events --group inventory.putaway --consumer.config /tmp/consumer.properties --from-beginning --max-messages 2 --timeout-ms 30000 --property print.key=true --property print.partition=true`,
    );
    const records = read.split('\n').filter((x) => x.includes(key));
    assert.equal(records.length, 2);
    assert.ok(records[0].endsWith('version-1'));
    assert.ok(records[1].endsWith('version-2'));
    assert.equal(records[0].split('\t')[0], records[1].split('\t')[0]);
    step('describe partition offsets');
    const offsets = exec(
      `/opt/kafka/bin/kafka-get-offsets.sh --bootstrap-server ${bootstrap} --command-config /tmp/consumer.properties --topic warehouse.receiving.events --time latest`,
    );
    assert.equal(
      offsets.split('\n').filter((line) => line.startsWith('warehouse.receiving.events:')).length,
      3,
    );
    step('deny consumer write');
    // Проверяем отказ самого broker, а не только наличие ACL в YAML. Диагностика остаётся внутри Pod.
    // Idempotence выключена только у запрещённого probe: проверяем topic Write,
    // а не более ранний отказ InitProducerId по cluster IdempotentWrite.
    exec(
      `/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server ${bootstrap} --topic warehouse.receiving.events --producer.config /tmp/consumer.properties --producer-property enable.idempotence=false >/tmp/denied 2>&1 || :; if ! grep -q TopicAuthorizationException /tmp/denied; then grep -Eo '(Topic|Group|Cluster)AuthorizationException|[A-Z_]*AUTHORIZATION_FAILED' /tmp/denied >&2 || :; exit 1; fi`,
      'denied:value\n',
    );
    step('deny foreign group');
    exec(
      `/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server ${bootstrap} --topic warehouse.receiving.events --group forbidden-group --consumer.config /tmp/consumer.properties --timeout-ms 10000 >/tmp/denied 2>&1 || :; grep -q GroupAuthorizationException /tmp/denied; rm /tmp/denied`,
    );
    console.log(
      'PASS WMS-501 mTLS publish/read, stable key/partition, broker restart persistence, ACL denials',
    );
  } finally {
    try {
      if (ownsCluster) run(kind, ['delete', 'cluster', '--name', cluster]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}
try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
