/** @file Проверка статических application imports: shared boundaries, private repositories и runtime cycles. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../apps/backend/node_modules/typescript');
/** Обходит собственные TS source files; зависимости/build output в граф не входят. */
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
  });
}
/** Проверяет уже разрешённый граф. Type-only связи проверяют границы, но не образуют runtime cycle. */
function inspectGraph(edges) {
  const errors = [];
  const graph = new Map();
  for (const { from, to, runtime } of edges) {
    if (from.startsWith('shared/') && /^(modules|infrastructure)\//.test(to))
      errors.push(`shared boundary: ${from} -> ${to}`);
    const owner = from.match(/^modules\/([^/]+)\//)?.[1];
    const target = to.match(/^modules\/([^/]+)\/repositories\//)?.[1];
    if (target && owner !== target) errors.push(`private repository: ${from} -> ${to}`);
    // Drizzle FK callbacks намеренно связывают schema definitions циклически. Их DDL проверяет migration suite.
    const schema = (file) => file.endsWith('.schema.ts') || path.basename(file) === 'schema.ts';
    if (runtime && !schema(from) && !schema(to)) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push(to);
    }
  }
  const visited = new Set(),
    active = new Set(),
    stack = [];
  const visit = (node) => {
    if (active.has(node)) {
      errors.push(`runtime cycle: ${[...stack.slice(stack.indexOf(node)), node].join(' -> ')}`);
      return;
    }
    if (visited.has(node)) return;
    active.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    active.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return errors;
}
/** Разрешает imports/exports/dynamic imports через тот же TypeScript resolver, что использует проект. */
function checkArchitecture(root) {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const source = path.join(root, 'src'),
    files = sourceFiles(source),
    edges = [];
  const relative = (file) => path.relative(source, file).split(path.sep).join('/');
  for (const file of files) {
    const ast = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const add = (specifier, runtime) => {
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (resolved && resolved.startsWith(source + path.sep))
        edges.push({ from: relative(file), to: relative(resolved), runtime });
    };
    const walk = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = node.importClause;
        const typeOnly =
          (ts.isExportDeclaration(node) &&
            node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((e) => e.isTypeOnly)) ||
          node.isTypeOnly ||
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly));
        add(node.moduleSpecifier.text, !typeOnly);
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        add(node.arguments[0].text, true);
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  return inspectGraph(edges);
}
module.exports = { inspectGraph, checkArchitecture };
if (require.main === module) {
  const errors = checkArchitecture(path.resolve(__dirname, '../../apps/backend'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Application import boundaries and runtime cycles: OK');
}
