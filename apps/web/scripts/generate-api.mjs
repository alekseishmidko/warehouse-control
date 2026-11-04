/** @file Offline API type generation из OpenAPI; --check сравнивает bytes, не меняет artifact. */
import openapiTS, { astToString } from 'openapi-typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = new URL('../../../docs/contracts/openapi.json', import.meta.url);
const output = new URL('../src/api/generated/schema.ts', import.meta.url);
if (process.argv.slice(2).some((arg) => arg !== '--check'))
  throw new Error('Usage: generate-api.mjs [--check]');
const schema = JSON.parse(await readFile(source, 'utf8'));
const generated = astToString(await openapiTS(schema));
const limits = {
  quantityMax: schema.components.schemas.CreateReceiptLineDto.properties.quantity.maximum,
  receiptLines: schema.components.schemas.CreateReceiptDto.properties.lines.maxItems,
  orderLines: schema.components.schemas.CreateOrderDto.properties.lines.maxItems,
};
if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
  throw new Error('OpenAPI limits missing');
const text =
  '/** @file GENERATED из docs/contracts/openapi.json; pnpm web:api:generate. Не редактировать вручную. */\n' +
  generated +
  '\n/** Лимиты формы из OpenAPI. Freeze предотвращает случайную замену общих чисел в UI; сервер повторно проверяет DTO. */\nexport const CONTRACT_LIMITS = Object.freeze(' +
  JSON.stringify(limits) +
  ');\n';
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== text)
    throw new Error('Web API types differ: run pnpm web:api:generate');
} else {
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, text);
}
