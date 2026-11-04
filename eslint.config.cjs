/** @file Typed ESLint: ошибки Promise/any/TS suppressions; форматирование остаётся Prettier. */
const tseslint = require('typescript-eslint');
const solid = require('eslint-plugin-solid');
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
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.{ts,tsx}', 'apps/web/vite.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './apps/web/tsconfig.json', tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, ...solid.configs['flat/typescript'].plugins },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      ...solid.configs['flat/typescript'].rules,
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
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/backend/**', '@backend/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
        },
      ],
    },
  },
];
