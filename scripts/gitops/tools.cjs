/** @file WMS-603: закреплённые инструменты GitOps; SHA256 проверяется до исполнения, outputs вне source inventory. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash } = require('../harness/snapshot.cjs');
const { execFileSync } = require('node:child_process');
const lock = require('../../infra/gitops/toolchain.json');
/** Загружает только source-pinned HTTPS artifact. Неполный download не заменяет готовый файл. */
async function checkedDownload(asset, file) {
  let url;
  try {
    url = new URL(asset.url);
  } catch {
    throw Error('Invalid pinned artifact');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    throw Error('Invalid pinned artifact');
  if (fs.existsSync(file) && hash(fs.readFileSync(file)) === asset.sha256) return file;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw Error('Pinned tool download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== asset.sha256) throw Error('Pinned tool checksum mismatch');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return file;
}
/** Устанавливает только ARM64 CLI; версия и digest источника являются частью task snapshot. */
async function ensureTools(directory) {
  const assets = lock.assets[process.platform + '-' + process.arch];
  if (!assets) throw Error('GitOps rehearsal requires native ARM64 darwin/linux');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = {};
  for (const asset of assets) {
    const file = await checkedDownload(
      asset,
      path.join(directory, asset.name + (asset.archive ? '.tar.gz' : '')),
    );
    if (asset.archive) {
      // Архив поставщика доверен только после checksum. Извлекаются два конкретных файла.
      execFileSync('tar', ['-xzf', file, '-C', directory, 'age/age', 'age/age-keygen']);
      result.age = path.join(directory, 'age/age');
      result.ageKeygen = path.join(directory, 'age/age-keygen');
    } else result[asset.name] = file;
  }
  for (const file of Object.values(result)) fs.chmodSync(file, 0o700);
  result.core = await checkedDownload(lock.core, path.join(directory, 'core-install.yaml'));
  return result;
}
if (require.main === module)
  ensureTools(
    path.resolve(
      process.argv[2] || 'artifacts/gitops-tools/' + process.platform + '-' + process.arch,
    ),
  )
    .then(() => console.log('Pinned GitOps tools verified'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { ensureTools, checkedDownload, hash };
