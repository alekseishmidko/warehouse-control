/** @file Offline Helm lint/template обоих profiles: fake immutable digest и Secret references без secret contents.
 * Не устанавливает resources в cluster; бинарник берётся из PATH либо известной локальной toolchain.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
/** Возвращает Helm; отсутствие инструмента — отказ, не skip. */
function helmBinary() {
  const candidates = [
    process.env.WMS_HELM ?? 'helm',
    '/opt/homebrew/bin/helm',
    '/usr/local/bin/helm',
    path.join(process.env.HOME, '.local/bin/helm'),
  ];
  for (const file of candidates) {
    try {
      const version = execFileSync(file, ['version', '--short'], { encoding: 'utf8' }).trim();
      if (/^v3\.22\.0(?:\+|$)/.test(version)) return file;
    } catch {}
  }
  throw new Error('Helm required: install pinned version from docs/flows/kind-helm.md');
}
/** Synthetic required values задают валидную форму, не выдают тестовый digest за доставленный image. */
function checkHelm(root) {
  const helm = helmBinary();
  const chart = path.join(root, 'infra/helm/warehouse');
  const settings = [
    '--set-string',
    'image.digest=sha256:' + 'a'.repeat(64),
    '--set-string',
    'database.runtimeSecret=runtime',
    '--set-string',
    'database.migrationSecret=migration',
    '--set-string',
    'auth.origin=https://warehouse.local',
    '--set-string',
    'auth.absoluteSeconds=600',
    '--set-string',
    'auth.idleSeconds=300',
  ];
  for (const profile of [[], ['-f', path.join(chart, 'values-dev.yaml')]]) {
    execFileSync(helm, ['lint', chart, '--strict', ...profile, ...settings], {
      stdio: 'pipe',
      timeout: 60000,
    });
    const rendered = execFileSync(helm, ['template', 'wms-check', chart, ...profile, ...settings], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (!rendered.includes('kind: Deployment') || rendered.includes('postgresql://'))
      throw Error('Unexpected rendered Helm output');
  }
  // Optional adapters проходят render отдельно: ошибки в выключенном template не должны скрыться.
  execFileSync(
    helm,
    [
      'template',
      'wms-check',
      chart,
      ...settings,
      '--set',
      'web.enabled=true,gateway.enabled=true,publisher.enabled=true',
      '--set-string',
      'web.image.digest=sha256:' + 'b'.repeat(64),
    ],
    { stdio: 'pipe', timeout: 60000 },
  );
}
if (require.main === module) {
  try {
    checkHelm(path.resolve(__dirname, '../..'));
    console.log('Helm profiles passed');
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
module.exports = { checkHelm, helmBinary };
