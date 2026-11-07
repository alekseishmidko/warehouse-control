/** @file Статический HTTP origin собранной SPA: только GET/HEAD, без proxy/auth и чтения вне build directory. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
/** Создаёт сервер без listen для тестов; root — доверенный immutable output Vite, не пользовательский каталог. */
function createStaticServer(root) {
  root = path.resolve(root);
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const fail = (status) => {
      response.statusCode = status;
      response.end();
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return fail(405);
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://static.local').pathname);
    } catch {
      return fail(400);
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return fail(404);
    // API никогда не заменяется index.html даже при неверной маршрутизации Gateway.
    if (pathname === '/api' || pathname.startsWith('/api/')) return fail(404);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) && file !== root) return fail(404);
    let target = file;
    let stat;
    try {
      stat = await fs.promises.stat(target);
    } catch {
      /* Ниже выбирается только разрешённый SPA fallback. */
    }
    if (!stat?.isFile()) {
      if (path.extname(pathname) || pathname.startsWith('/assets/')) return fail(404);
      target = path.join(root, 'index.html');
      try {
        stat = await fs.promises.stat(target);
      } catch {
        return fail(503);
      }
    }
    response.setHeader('Content-Type', types[path.extname(target)] ?? 'application/octet-stream');
    response.setHeader('Content-Length', stat.size);
    if (pathname.startsWith('/assets/'))
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (request.method === 'HEAD') return response.end();
    // При ошибке файла после headers закрываем stream, не отправляем filesystem path клиенту.
    const stream = fs.createReadStream(target);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
}
if (require.main === module) {
  const server = createStaticServer(path.resolve(__dirname, '../dist'));
  server.listen(8080, '0.0.0.0');
  const stop = () =>
    server.close((error) => {
      process.exitCode = error ? 1 : 0;
    });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
module.exports = { createStaticServer };
