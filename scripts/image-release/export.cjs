/** @file WMS-602: экспортирует только bytes финального successful scan, а не произвольный mutable tag.
 * Сохраняет identity evidence для packages:write publisher, который не исполняет source scripts. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { writeAtomicJson } = require('../evidence/atomic-json.cjs');
const { archiveConfigId } = require('./scan.cjs');
const { validateReport } = require('./policy.cjs');
const exceptions = require('./exceptions.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Принимает только scan, на который ссылается successful текущий harness log с сохранённым hash. */
function checkedScan(root, commit) {
  const base = path.join(root, 'artifacts/harness/wms-602');
  const evidence = JSON.parse(fs.readFileSync(path.join(base, 'latest.json')));
  if (evidence.status !== 'passed' || !/^[a-f0-9-]{36}$/.test(evidence.run))
    throw Error('Successful current harness required');
  const result = evidence.results.find((r) => r.id === 'imageScan');
  const log = fs.readFileSync(path.join(base, evidence.run, 'imageScan.log'));
  if (result?.code !== 0 || result.logHash !== sha256(log)) throw Error('Unverified scan log');
  const matches = [...log.toString().matchAll(/^Image scan evidence: (.+)$/gm)];
  if (matches.length !== 1) throw Error('Expected one final scan summary');
  const file = fs.realpathSync(matches[0][1]);
  if (
    !file.startsWith(fs.realpathSync(path.join(root, 'artifacts/image-scan')) + path.sep) ||
    path.basename(file) !== 'summary.json'
  )
    throw Error('Unexpected scan scope');
  const bytes = fs.readFileSync(file);
  const scan = JSON.parse(bytes);
  if (
    scan.status !== 'passed' ||
    scan.commit !== commit ||
    scan.images?.length !== 2 ||
    !['backend', 'web'].every((app) => scan.images.filter((i) => i.app === app).length === 1)
  )
    throw Error('Scan must cover both images of this commit');
  return {
    scan,
    scanSha256: sha256(bytes),
    harnessRun: evidence.run,
    directory: path.dirname(file),
  };
}
/** Экспортирует tag только после inspect identity check и проверяет config bytes tar после save.
 * Вторая проверка ловит замену tag между inspect/save. При ошибке metadata/commit marker не публикуются.
 * Docker — injectable I/O boundary для race regression; tar/config parsing и filesystem остаются реальными. */
async function exportCheckedImages(
  root,
  commit,
  docker = (args) =>
    execFileSync('docker', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    }),
) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw Error('Exact release commit required');
  const checked = checkedScan(root, commit);
  const directory = path.join(root, 'artifacts/release');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.readdirSync(directory).length) throw Error('Export directory must be empty');
  const owned = [];
  const output = {
    commit,
    harnessRun: checked.harnessRun,
    scanSha256: checked.scanSha256,
    images: [],
  };
  try {
    for (const app of ['backend', 'web']) {
      const scanned = checked.scan.images.find((i) => i.app === app);
      if (
        !/^sha256:[a-f0-9]{64}$/.test(scanned.imageId) ||
        !/^sha256:[a-f0-9]{64}$/.test(scanned.configId)
      )
        throw Error('Invalid scanned image identity');
      const report = fs.readFileSync(path.join(checked.directory, app + '.json'));
      if (sha256(report) !== scanned.reportSha256) throw Error('Scanned report changed');
      validateReport(JSON.parse(report), scanned.configId, {
        exceptions,
        proof: scanned.runtimeProof,
      });
      const tag = `warehouse-${app}:local`;
      const actual = docker(['image', 'inspect', '--format', '{{.Id}}', tag]).trim();
      if (actual !== scanned.imageId) throw Error(`Mutable ${app} tag changed after scan`);
      const archive = path.join(directory, app + '.tar');
      owned.push(archive);
      docker(['image', 'save', '-o', archive, tag]);
      if (archiveConfigId(archive) !== scanned.configId)
        throw Error(`Exported ${app} config differs from scan`);
      const hash = createHash('sha256');
      for await (const bytes of fs.createReadStream(archive)) hash.update(bytes);
      output.images.push({
        app,
        imageId: actual,
        configId: scanned.configId,
        archiveSha256: hash.digest('hex'),
      });
    }
    const marker = path.join(directory, 'commit.txt');
    owned.push(marker);
    fs.writeFileSync(marker, commit + '\n', { flag: 'wx', mode: 0o600 });
    const file = path.join(directory, 'export-evidence.json');
    owned.push(file);
    await writeAtomicJson(file, output);
    return output;
  } catch (error) {
    for (const file of owned) fs.rmSync(file, { force: true });
    throw error;
  }
}
/** Workflow-only entrypoint: readiness повторно проверяется перед export; source HEAD совпадает с GITHUB_SHA. */
async function main() {
  const root = path.resolve(__dirname, '../..');
  const commit = process.env.GITHUB_SHA;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ARCH !== 'ARM64')
    throw Error('ARM64 Actions export required');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== commit)
    throw Error('Release source commit differs');
  execFileSync('pnpm', ['harness:ready', 'docs/tasks/wms-602.json'], {
    cwd: root,
    stdio: 'inherit',
  });
  await exportCheckedImages(root, commit);
  console.log('PASS export bytes match final checked scan');
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { exportCheckedImages };
