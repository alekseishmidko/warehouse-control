/**
 * @file Воспроизводимое покрытие identity поверх обычных unit/integration suites.
 * Нужен Docker: настоящие guards/SQL/rollback не заменяются mocks ради процентов.
 * Controller имеет обязательные 100% statements/branches/functions/lines. Остальные
 * файлы показаны для диагностики; bootstrap исполняется child CLI и его coverage сюда
 * не объединяется. Interfaces/decorated DTO могут давать технические V8 gaps.
 */
const baseline = require('./jest.config.cjs');
module.exports = {
  ...baseline,
  collectCoverage: true,
  coverageProvider: 'v8',
  collectCoverageFrom: ['dist/modules/identity/**/*.js'],
  coverageDirectory: 'coverage/identity',
  coverageReporters: ['text', 'json-summary', 'html'],
  coverageThreshold: {
    './src/modules/identity/identity.controller.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
