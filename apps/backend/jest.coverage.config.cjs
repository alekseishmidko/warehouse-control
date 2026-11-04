/** @file Полное измерение собственного backend: неисполненные файлы остаются в отчёте, generated исключён по происхождению. */
const identity = require('./jest.identity-coverage.config.cjs');
module.exports = {
  ...identity,
  collectCoverageFrom: ['dist/**/*.js', '!dist/**/generated/**'],
  coverageDirectory: 'coverage/backend',
  coverageReporters: ['text-summary', 'json-summary', 'html'],
};
