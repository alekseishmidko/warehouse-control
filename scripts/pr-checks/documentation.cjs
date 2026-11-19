/** @file WMS-601: локальные Markdown links/anchors, каталог файлов и структурное наличие документации.
 * Не ходит в сеть и не оценивает содержательность JSDoc. Generated/applied output имеет явного владельца.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { ownFiles } = require('./source-inventory.cjs');
/** Fenced/inline code не является Markdown navigation. Каталог разбирается отдельно по исходному тексту. */
function prose(text) {
  return text
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '');
}
/** GitHub-подобные slugs с повторными headings. HTML anchors также разрешены. */
function anchors(text) {
  const result = new Set();
  const counts = new Map();
  for (const match of text
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
    .matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1]
      .replace(/`+/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    result.add(slug + (count ? '-' + count : ''));
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}
/** Проверяет только repository-local targets; external URLs не считаются проверенными online. */
function linkErrors(root, file, text) {
  root = fs.realpathSync(root);
  const errors = [];
  const links = [
    ...prose(text).matchAll(/\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\s*\)/g),
  ].map((m) => m[1].replace(/^<|>$/g, ''));
  for (const match of prose(text).matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) links.push(match[1]);
  for (const target of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      errors.push(`${file}: invalid link encoding ${target}`);
      continue;
    }
    const [targetName, fragment] = decoded.split('#');
    const name = targetName.replace(/:\d+$/, '');
    const absolute = name
      ? path.resolve(
          name.startsWith('/') ? root : path.dirname(path.join(root, file)),
          '.' + (name.startsWith('/') ? name : '/' + name),
        )
      : path.join(root, file);
    if (
      !absolute.startsWith(root + path.sep) ||
      !fs.existsSync(absolute) ||
      !fs.realpathSync(absolute).startsWith(root + path.sep)
    ) {
      errors.push(`${file}: missing link ${target}`);
      continue;
    }
    if (
      fragment &&
      fs.statSync(absolute).isFile() &&
      /\.md$/i.test(absolute) &&
      !anchors(fs.readFileSync(absolute, 'utf8')).has(fragment)
    )
      errors.push(`${file}: missing anchor ${target}`);
  }
  return errors;
}
/** Источник и команда generated output описаны у владельца; applied migrations не меняются ради комментариев. */
function generated(file) {
  return /^(apps\/backend\/src\/shared\/events\/generated\/|apps\/web\/src\/api\/generated\/|apps\/backend\/drizzle\/)/.test(
    file,
  );
}
/** Проверяет public TS functions/classes/methods через compiler AST. Private implementation не требует формальных пустых docs. */
function publicDocErrors(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const errors = [];
  const documented = (node) => ts.getJSDocCommentsAndTags(node).length > 0;
  const exported = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      exported(node) &&
      !documented(node)
    )
      errors.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: public declaration needs JSDoc ${node.name?.getText(source) ?? ''}`,
      );
    if (
      ts.isMethodDeclaration(node) &&
      ts.isClassDeclaration(node.parent) &&
      exported(node.parent) &&
      !node.modifiers?.some((m) =>
        [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind),
      ) &&
      !documented(node)
    )
      errors.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: public method needs JSDoc ${node.name.getText(source)}`,
      );
    if (ts.isVariableStatement(node) && exported(node) && !documented(node))
      for (const declaration of node.declarationList.declarations)
        if (
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        )
          errors.push(
            `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: exported function value needs JSDoc ${declaration.name.getText(source)}`,
          );
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
/** Structural gate проверяет все собственные файлы; caller может передать inventory для disposable negative test. */
/** Каталог считается явным списком, а не поиском подстроки: a.ts не покрывается записью a.ts.old. */
function catalogFiles(root, text) {
  const result = new Set();
  for (const match of text.matchAll(/`([^`\n]+)`/g)) result.add(match[1]);
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!/^[a-z]+:/i.test(target))
      result.add(
        path
          .relative(root, path.resolve(root, 'docs', target))
          .split(path.sep)
          .join('/'),
      );
  }
  for (const line of text.split('\n')) {
    const column = line.match(/^\|\s*([^|]+?)\s*\|/)?.[1];
    if (column && /^[a-zA-Z0-9_.-]+\//.test(column.trim())) result.add(column.trim());
  }
  return result;
}
function checkDocumentation(root, files = ownFiles(root)) {
  root = fs.realpathSync(root);
  const errors = [];
  const catalog = catalogFiles(
    root,
    fs.readFileSync(path.join(root, 'docs/file-catalog.md'), 'utf8'),
  );
  for (const file of files) {
    if (fs.lstatSync(path.join(root, file)).isSymbolicLink()) {
      errors.push(`source symlink unsupported: ${file}`);
      continue;
    }
    if (!catalog.has(file)) errors.push(`catalog missing: ${file}`);
    if (file.endsWith('.md'))
      errors.push(...linkErrors(root, file, fs.readFileSync(path.join(root, file), 'utf8')));
    if (generated(file)) continue;
    if (/\.(?:[cm]?js|tsx?)$/.test(file)) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x')
          ? ts.ScriptKind.TSX
          : /\.[cm]?js$/.test(file)
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS,
      );
      for (const diagnostic of source.parseDiagnostics)
        errors.push(
          `${file}: syntax ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
        );
      const header = text.match(/^\s*(?:#![^\n]*\n)?\s*(\/\*\*[\s\S]*?\*\/)/)?.[1];
      if (!header || !/@file\b/.test(header))
        errors.push(`${file}: file-level @file JSDoc missing`);
      if (/^apps\/(backend|web)\/src\//.test(file)) errors.push(...publicDocErrors(file, text));
    }
  }
  for (const base of [
    'apps/backend/src/modules',
    'apps/backend/src/shared',
    'apps/backend/src/infrastructure',
  ])
    if (fs.existsSync(path.join(root, base)))
      for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true }))
        if (entry.isDirectory() && !files.includes(`${base}/${entry.name}/README.md`))
          errors.push(`module README missing: ${base}/${entry.name}`);
  return errors;
}
if (require.main === module) {
  const errors = checkDocumentation(path.resolve(__dirname, '../..'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Documentation inventory, local links and JSDoc passed');
}
module.exports = {
  ownFiles,
  linkErrors,
  publicDocErrors,
  checkDocumentation,
  anchors,
  catalogFiles,
};
