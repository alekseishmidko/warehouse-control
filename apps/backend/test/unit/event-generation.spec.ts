/** @file Воспроизводимость generation и обнаружение missing/stale artifacts в temporary directory, без изменения checkout. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Генератор запускается обычным Node: Prettier использует ESM import, для которого не нужен experimental Jest VM. */
async function generateEventContracts(options: {
  check?: boolean;
  outputDirectory: string;
}): Promise<void> {
  // Передаём options отдельным argv, без shell-интерполяции путей или содержимого JSON.
  await execFileAsync(
    process.execPath,
    [
      '-e',
      'require(process.argv[1]).generateEventContracts(JSON.parse(process.argv[2])).catch(error => { console.error(error.message); process.exitCode = 1; })',
      resolve('scripts/generate-event-contracts.cjs'),
      JSON.stringify(options),
    ],
    { timeout: 10000 },
  );
}

test('generation is deterministic; check fails for missing and stale files without rewriting them', async () => {
  // Отдельный каталог исключает гонки с production artifacts и запуском test:prepare.
  const outputDirectory = await mkdtemp(join(tmpdir(), 'warehouse-contracts-'));
  try {
    // Check на пустом output должен завершаться ошибкой, не создавать файлы самостоятельно.
    await expect(generateEventContracts({ outputDirectory, check: true })).rejects.toThrow(
      'differ',
    );
    await generateEventContracts({ outputDirectory });
    const path = join(outputDirectory, 'event-types.ts');
    const first = await readFile(path, 'utf8');
    await generateEventContracts({ outputDirectory });
    expect(await readFile(path, 'utf8')).toBe(first);
    await expect(generateEventContracts({ outputDirectory, check: true })).resolves.toBeUndefined();
    // Имитируем ручное изменение generated code; check обнаруживает его и сохраняет как есть.
    await writeFile(path, `${first}\n// stale\n`);
    await expect(generateEventContracts({ outputDirectory, check: true })).rejects.toThrow(
      'event-types.ts',
    );
    expect(await readFile(path, 'utf8')).toContain('// stale');
    await generateEventContracts({ outputDirectory });
    // Runtime bundle проверяется отдельно: одного совпадения TS declarations недостаточно.
    const schemaPath = join(outputDirectory, 'event-schemas.ts');
    await writeFile(schemaPath, '// stale schema\n');
    await expect(generateEventContracts({ outputDirectory, check: true })).rejects.toThrow(
      'event-schemas.ts',
    );
  } finally {
    // Cleanup срабатывает и при упавшем assertion/generator, не оставляя temporary artifacts.
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
