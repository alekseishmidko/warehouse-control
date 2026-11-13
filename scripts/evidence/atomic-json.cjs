/** @file Атомарная публикация host-side evidence: старый файл заменяется только готовым JSON. */
const fs = require('node:fs/promises');
const { dirname, join, basename } = require('node:path');
const { randomUUID } = require('node:crypto');
/** Temp создаётся на том же filesystem, unique + wx исключают коллизию писателей.
 * Ошибка write/rename сохраняет accepted файл; finally удаляет только собственный temp.
 * io — injectable filesystem для воспроизведения частичного write/EIO в regression test. */
async function writeAtomicJson(path, value, io = fs) {
  await io.mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.tmp');
  try {
    await io.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await io.rename(temporary, path);
  } finally {
    await io.rm(temporary, { force: true });
  }
}
module.exports = { writeAtomicJson };
