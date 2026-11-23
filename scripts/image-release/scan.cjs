/** @file WMS-602: локальный scan runtime images без публикации. Каждый запуск сохраняет отдельные отчёты; ошибка не создаёт passed. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const { validateReport } = require('./policy.cjs');
const { verifyRuntime } = require('./runtime.cjs');
const exceptions = require('./exceptions.json');
const scannerVersion = '0.76.2';
/** Локальные TRIVY_* могут скрыть finding или устаревшую DB; политика не наследует такие overrides.
 * Выбор HTTP proxy и системного trust store сохраняется для разрешённого доступа к DB. */
function scannerEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith('TRIVY_')),
  );
}
/** Config digest из реальных bytes Docker archive: inspect ID может обозначать OCI index.
 * Разрешён ровно один runtime manifest; config path не исполняется shell и не извлекается на диск. */
function archiveConfigId(archive) {
  const manifests = JSON.parse(
    execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8' }),
  );
  if (
    !Array.isArray(manifests) ||
    manifests.length !== 1 ||
    typeof manifests[0]?.Config !== 'string' ||
    !/^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/.test(manifests[0].Config)
  )
    throw Error('Expected single runtime image archive');
  const config = execFileSync('tar', ['-xOf', archive, manifests[0].Config]);
  return 'sha256:' + createHash('sha256').update(config).digest('hex');
}
/** Экспортирует точный local image ID; Trivy не получает Docker socket, registry credentials или build secrets.
 * Вызов синхронный с deadline. Tar удаляется finally, полный JSON сохраняется и при policy rejection. */
function scanImage(root, directory, app, scanner) {
  const config = path.join(directory, 'trivy.json');
  fs.writeFileSync(config, '{}\n', { mode: 0o600 });
  const image = `warehouse-${app}:local`;
  const imageId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Invalid Docker image ID');
  const archive = path.join(directory, `${app}.tar`);
  const reportFile = path.join(directory, `${app}.json`);
  try {
    execFileSync('docker', ['image', 'save', '-o', archive, imageId], {
      timeout: 120000,
      stdio: 'inherit',
    });
    // Полный отчёт содержит также unfixed. Exit scanner отдельно от решения policy позволяет сохранить findings.
    execFileSync(
      scanner,
      [
        '--config',
        config,
        'image',
        '--input',
        archive,
        '--scanners',
        'vuln',
        '--pkg-types',
        'os,library',
        '--ignorefile',
        '',
        '--ignore-unfixed=false',
        '--format',
        'json',
        '--output',
        reportFile,
        '--exit-code',
        '0',
        '--timeout',
        '10m',
      ],
      { cwd: root, env: scannerEnvironment(process.env), timeout: 660000, stdio: 'inherit' },
    );
    const bytes = fs.readFileSync(reportFile);
    const configId = archiveConfigId(archive);
    const proof = verifyRuntime(imageId);
    const counts = validateReport(JSON.parse(bytes), configId, { exceptions, proof });
    return {
      app,
      imageId,
      configId,
      counts,
      runtimeProof: proof,
      reportSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    fs.rmSync(archive, { force: true });
  }
}
/** Новый UUID исключает повторное использование прежнего passed; summary пишет общий atomic-json owner.
 * Скрипт не выполняет build: перед ним обязательны image gates. Git HEAD фиксирует revision, не чистоту checkout.
 * Локальный image ID не является registry manifest digest; внешний pull остаётся отдельным AC WMS-602.5. */
async function main() {
  const root = path.resolve(__dirname, '../..');
  const scanner = process.env.WMS_TRIVY || 'trivy';
  const version = execFileSync(scanner, ['--version'], { encoding: 'utf8', timeout: 30000 });
  if (!version.split(/\r?\n/).includes(`Version: ${scannerVersion}`))
    throw Error(`Trivy ${scannerVersion} required`);
  const directory = path.join(root, 'artifacts/image-scan', randomUUID());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const summary = {
    status: 'running',
    scannerVersion,
    policySha256: createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, 'exceptions.json')))
      .digest('hex'),
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSnapshot: require('../harness/snapshot.cjs').snapshot(root).digest,
    images: [],
  };
  const file = path.join(directory, 'summary.json');
  await writeAtomicJson(file, summary);
  try {
    for (const app of ['backend', 'web'])
      summary.images.push(scanImage(root, directory, app, scanner));
    summary.status = 'passed';
  } catch (error) {
    summary.status = 'failed';
    throw error;
  } finally {
    await writeAtomicJson(file, summary);
    console.log(`Image scan evidence: ${file}`);
  }
  return { summary, file };
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validateReport, scannerEnvironment, archiveConfigId, scanLocalImages: main };
