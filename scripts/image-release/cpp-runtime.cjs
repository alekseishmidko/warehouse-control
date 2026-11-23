/** @file WMS-604 R2: перенос только C++ runtime packages из pinned cc в payload поверх base-nossl; libssl не наследуется. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const packages = ['gcc-14-base', 'libgcc-s1', 'libstdc++6'];
/** Сохраняет доступные upstream package files/metadata/licenses и SONAME links. Источник доверен по Docker FROM digest, md5 — дополнительная сверка inventory. */
function copyCppRuntime(source, output, architecture = process.arch) {
  const triplet = { arm64: 'aarch64-linux-gnu', x64: 'x86_64-linux-gnu' }[architecture];
  assert.ok(triplet, 'Unsupported C++ runtime architecture');
  assert.ok(!fs.existsSync(output), 'Runtime payload must be new');
  fs.mkdirSync(output, { recursive: true });
  function copy(relative) {
    assert.ok(
      !path.isAbsolute(relative) && !relative.split('/').includes('..'),
      'Unsafe package inventory',
    );
    assert.ok(!/lib(?:ssl|crypto)/i.test(relative), 'SSL package payload rejected');
    const from = path.join(source, relative),
      to = path.join(output, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
  for (const name of packages) {
    const metadata = 'var/lib/dpkg/status.d/' + name;
    assert.ok(
      fs.readFileSync(path.join(source, metadata), 'utf8').includes('Package: ' + name + '\n'),
      'Package metadata mismatch',
    );
    copy(metadata);
    copy(metadata + '.md5sums');
    for (const line of fs
      .readFileSync(path.join(source, metadata + '.md5sums'), 'utf8')
      .trim()
      .split('\n')) {
      const match = /^([a-f0-9]{32})  (.+)$/.exec(line);
      assert.ok(match, 'Invalid package inventory');
      const relative = match[2];
      assert.ok(
        !path.isAbsolute(relative) && !relative.split('/').includes('..'),
        'Unsafe package inventory',
      );
      const file = path.join(source, relative);
      // Distroless уже исключил часть Debian docs/debug files. Не создаём metadata-only libraries вместо фактических bytes.
      if (!fs.existsSync(file)) continue;
      assert.equal(
        createHash('md5').update(fs.readFileSync(file)).digest('hex'),
        match[1],
        'Package file checksum mismatch',
      );
      copy(relative);
    }
    const docs = 'usr/share/doc/' + name;
    if (fs.existsSync(path.join(source, docs))) copy(docs);
  }
  const directory = 'usr/lib/' + triplet;
  for (const name of fs.readdirSync(path.join(source, directory))) {
    if (/^lib(?:stdc\+\+|gcc_s)\.so\./.test(name)) copy(directory + '/' + name);
  }
  for (const name of ['libstdc++.so.6', 'libgcc_s.so.1'])
    assert.ok(fs.existsSync(path.join(output, directory, name)), 'Required SONAME missing');
}
if (require.main === module) copyCppRuntime(process.argv[2], process.argv[3]);
module.exports = { copyCppRuntime };
