/** @file Jest projects: unit без Docker, integration с реальным PostgreSQL; compiled TS tests. */
const common = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: { '^@backend/(.*)$': '<rootDir>/dist/$1' },
  clearMocks: true,
  restoreMocks: true,
};

module.exports = {
  maxWorkers: 2,
  testTimeout: 15000,
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/.test-dist/test/unit/**/*.spec.js'] },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['<rootDir>/.test-dist/test/integration/**/*.spec.js'],
      setupFilesAfterEnv: ['<rootDir>/test/integration.setup.cjs'],
    },
  ],
};
