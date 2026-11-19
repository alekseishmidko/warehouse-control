/** @file Общий source inventory PR guards: один список Git files для docs и compatibility.
 * Build/cache/dependencies исключает Git ignore, новые собственные файлы включаются до commit.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
/** Возвращает существующие repo-relative paths, включая tracked ignored, без duplicates и удалённых файлов. */
function ownFiles(root) {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean),
    ),
  ].filter((file) => fs.existsSync(path.join(root, file)));
}
module.exports = { ownFiles };
