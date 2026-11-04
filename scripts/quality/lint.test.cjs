/** @file Проверяет реальные typed lint rules на заведомо неверном input, а не только наличие config. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');
test('floating Promise, explicit any и ts-ignore блокируются', async () => {
  const linter = new ESLint();
  // Настоящий путь включает config/project typing; виртуальный текст не сохраняется в рабочие исходники.
  const [result] = await linter.lintText(
    'async function operation(): Promise<void> {}\noperation();\nconst value: any = 1;\n// @ts-ignore\nvalue.foo();\n',
    { filePath: path.resolve('apps/backend/src/app.service.ts') },
  );
  for (const rule of ['no-floating-promises', 'no-explicit-any', 'ban-ts-comment'])
    assert.ok(
      result.messages.some((m) => m.ruleId === `@typescript-eslint/${rule}`),
      rule,
    );
});
