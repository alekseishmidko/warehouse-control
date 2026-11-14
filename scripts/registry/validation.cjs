/** @file Строгая проверка Git/Registry schemas и fixtures тем же Ajv dialect, что использует consumer. */
const { createRequire } = require('node:module');
const path = require('node:path');
const { root } = require('./contracts.cjs');
const backendRequire = createRequire(path.join(root, 'apps/backend/package.json'));
const Ajv2020 = backendRequire('ajv/dist/2020');
const addFormats = backendRequire('ajv-formats');
/** Новый экземпляр не смешивает revisions с одинаковым $id.
 * Без coercion/defaults/removal; validateSchema включён явно, поскольку native
 * Registry VALIDITY не заменяет metaschema2020-12 validation.
 */
function createEventAjv() {
  const instance = new Ajv2020({
    strict: true,
    validateSchema: true,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  addFormats(instance, { mode: 'full' });
  return instance;
}
module.exports = { createEventAjv };
