/**
 * @file Единое форматирование monorepo: pnpm format / pnpm format:check из корня.
 * Generated artifacts, applied migrations, lockfile и credentials исключает .prettierignore.
 * Это форматирование, не lint/typecheck: бизнес-инварианты по-прежнему проверяют TS/Jest.
 */
module.exports = {
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  trailingComma: 'all',
  printWidth: 100,
  endOfLine: 'lf',
  proseWrap: 'preserve',
};
