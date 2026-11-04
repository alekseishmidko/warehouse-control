/** @file Typed ESLint: ошибки Promise/any/TS suppressions; форматирование остаётся Prettier. */
const tseslint = require('typescript-eslint');
module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.test-dist/**',
      '**/coverage/**',
      '**/generated/**',
    ],
  },
  {
    files: ['apps/backend/src/**/*.ts', 'apps/backend/test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./apps/backend/tsconfig.json', './apps/backend/tsconfig.test.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 12,
        },
      ],
    },
  },
];
