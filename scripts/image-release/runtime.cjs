/** @file WMS-602: фактические ограничения минимального Node runtime для image gate и advisory review.
 * Запускает проверяемый image по immutable ID без сети/записи; отсутствие native addons важно для iconv exception. */
const { execFileSync } = require('node:child_process');
const runtimeBase = 'sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2';
const nodeVersion = 'v24.22.3';
/** Проверяет точный base label, Node/uid, отсутствие tooling/native addons и shared OpenSSL.
 * Это evidence для текущего JS-only приложения, не универсальная гарантия для произвольного кода/volume mounts.
 * Любое нарушение отменяет исключения и даёт nonzero image gate. */
function verifyRuntime(image) {
  const base = execFileSync(
    'docker',
    [
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.warehouse.runtime.base"}}',
      image,
    ],
    { encoding: 'utf8', timeout: 30000 },
  ).trim();
  if (base !== runtimeBase) throw Error('Unreviewed runtime base');
  const output = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--read-only',
      '--network=none',
      '--entrypoint',
      'node',
      image,
      '-e',
      `
    const a=require('node:assert/strict'),f=require('node:fs'),p=require('node:path');
    a.equal(process.version,${JSON.stringify(nodeVersion)}); a.equal(process.getuid(),1000);
    a.equal(process.config.variables.node_shared_openssl,false);
    a.ok(!process.report.getReport().sharedObjects.some(x=>/lib(?:ssl|crypto)\\.so/.test(x)));
    for(const x of ['/usr/local/lib/node_modules','/opt/yarn','/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/corepack','/usr/local/bin/yarn','/bin/sh','/usr/bin/apt','/usr/bin/dpkg','/usr/bin/iconv','/usr/bin/openssl']) a.ok(!f.existsSync(x),x);
    const visited=new Set(); function walk(dir){const real=f.realpathSync(dir);if(visited.has(real))return;visited.add(real);for(const name of f.readdirSync(dir)){const file=p.join(dir,name);a.ok(!file.endsWith('.node'),file);if(f.statSync(file).isDirectory())walk(file);}}
    walk('/workspace');
    console.log(JSON.stringify({nodeVersion:process.version,jsOnly:true,sharedOpenSSL:false,toolingAbsent:true}));
  `,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  return { base, ...JSON.parse(output) };
}
module.exports = { verifyRuntime, runtimeBase, nodeVersion };
