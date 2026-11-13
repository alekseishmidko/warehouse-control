/** @file Реальный filesystem + write/rename faults: accepted evidence переживает частичную запись. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { writeAtomicJson } = require('./atomic-json.cjs');
test('partial write and rename failure preserve accepted evidence and remove temp', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'evidence-test-'));
  const path = join(dir, 'accepted.json');
  try {
    await writeAtomicJson(path, { version: 'old' });
    for (const fault of ['write', 'rename']) {
      const io = {
        ...fs,
        ...(fault === 'write'
          ? {
              writeFile: async (...args) => {
                await fs.writeFile(args[0], 'partial', args[2]);
                throw Error('injected EIO');
              },
            }
          : {
              rename: async () => {
                throw Error('injected rename failure');
              },
            }),
      };
      await assert.rejects(writeAtomicJson(path, { version: 'new' }, io));
      assert.deepEqual(JSON.parse(await fs.readFile(path)), { version: 'old' });
      assert.deepEqual(await fs.readdir(dir), ['accepted.json']);
    }
    await writeAtomicJson(path, { version: 'new' });
    assert.deepEqual(JSON.parse(await fs.readFile(path)), { version: 'new' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
