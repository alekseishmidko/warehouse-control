/** @file WMS-502: AsyncAPI generation/diff, source schemas/fixtures и Git compatibility. Не запускает producer. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Parser } = require('@asyncapi/parser');
const { loadContracts, asyncApiDocument, assertCompatible, root } = require('./contracts.cjs');
const { createEventAjv } = require('./validation.cjs');
/** Стандартный AsyncAPI parser поддерживает draft07; явный plugin сохраняет 2020-12 вместо downgrade. */
async function validateAsyncApi(document) {
  const parser = new Parser();
  parser.registerSchemaParser({
    getMimeTypes: () => ['application/schema+json;version=draft-2020-12'],
    parse: async (input) => input.data,
    validate: async (input) => {
      try {
        createEventAjv().compile(input.data);
        return [];
      } catch {
        return [{ message: 'Invalid draft 2020-12 payload schema', path: input.path }];
      }
    },
  });
  const result = await parser.parse(JSON.stringify(document));
  assert.ok(
    !result.diagnostics.some((d) => d.severity === 0),
    'AsyncAPI validation failed: ' +
      result.diagnostics
        .filter((d) => d.severity === 0)
        .map((d) => d.message)
        .join('; '),
  );
}
/** Обязательный offline gate до Registry I/O. Existing schema revision сравнивается с выбранным Git commit. */
async function check({ write = false, base = 'HEAD' } = {}) {
  const contracts = loadContracts();
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  for (const c of contracts) {
    const validator = createEventAjv().compile(c.schema);
    assert.ok(validator(c.example), 'Git example fails ' + c.name);
    const filename = 'docs/contracts/events/' + c.name + '.schema.json';
    const exists = execFileSync('git', ['ls-tree', commit, '--', filename], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (exists)
      assertCompatible(
        JSON.parse(
          execFileSync('git', ['show', commit + ':' + filename], { cwd: root, encoding: 'utf8' }),
        ),
        c.schema,
      );
  }
  const document = asyncApiDocument(contracts);
  await validateAsyncApi(document);
  const filename = path.join(root, 'docs/contracts/asyncapi.json');
  const text = JSON.stringify(document, null, 2) + '\n';
  if (write) fs.writeFileSync(filename, text);
  else
    assert.equal(
      fs.readFileSync(filename, 'utf8'),
      text,
      'AsyncAPI drift: run pnpm asyncapi:generate',
    );
  return contracts;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const allowed =
    args.length === 0 ||
    (args.length === 1 && args[0] === '--write') ||
    (args.length === 2 && args[0] === '--base');
  assert.ok(allowed, 'usage: check.cjs [--write | --base COMMIT]');
  check({ write: args[0] === '--write', base: args[0] === '--base' ? args[1] : 'HEAD' })
    .then(() => console.log('PASS WMS-502 Git schemas/compatibility/AsyncAPI'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { check, createEventAjv, validateAsyncApi };
